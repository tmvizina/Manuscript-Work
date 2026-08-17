import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ContentDatabase, nowIso, rootValue } from "./common.js";
import { isPathInside, resolveInside } from "./paths.js";

/** Book roots under a manuscript project. Keep these IDs stable: they are part
 * of the chapter table's public identity. */
export const BOOK_ROOTS = [
  { book: "book-1", dir: "chapters" },
  { book: "book-2", dir: join("book-2", "chapters") },
  { book: "prequel", dir: join("prequel-novella", "chapters") },
] as const;

export const CHAPTER_RE = /^Chapter\s+(\d+(?:\.\d+)?)\s*-\s*(.+)\.txt$/i;

export interface ChapterName {
  number: number;
  title: string;
}

export interface ChapterFile {
  chapter_id: string;
  book: string;
  rel_path: string;
  /** Absolute source path, useful to callers that need to inspect the file. */
  path: string;
  number: number;
  title: string;
  text: string;
  sha256: string;
  word_count: number;
  file_mtime: string;
  /** File size in bytes, captured before content hydration. */
  file_size: number;
}

/** Filesystem metadata captured without reading chapter contents. */
export type ChapterFileMetadata = Omit<ChapterFile, "text" | "sha256" | "word_count">;

export interface ChapterSyncResult {
  scanned: number;
  added: number;
  updated: number;
  unchanged: number;
  deactivated: number;
}

export interface ChapterSyncOptions {
  manuscriptRoot: string;
}

export function parseChapterName(filename: string): ChapterName {
  const match = CHAPTER_RE.exec(filename);
  if (match) return { number: parseFloat(match[1]), title: match[2].trim() };
  // Defensive fallback: malformed names remain visible rather than silently
  // disappearing from a project's chapter scan.
  return { number: 9999, title: filename.replace(/\.txt$/i, "") };
}

function chapterOptions(options: ChapterSyncOptions | string): ChapterSyncOptions {
  return typeof options === "string" ? { manuscriptRoot: options } : options;
}

/**
 * Enumerate chapter files and capture only metadata.
 *
 * Sync callers use this pass to avoid opening and hashing chapters whose
 * stored mtime and byte size are unchanged. `scanChapterFiles` remains the
 * fully hydrated compatibility API for callers that need the text itself.
 */
export function scanChapterFileMetadata(options: ChapterSyncOptions | string): ChapterFileMetadata[] {
  const { manuscriptRoot } = chapterOptions(options);
  const root = rootValue(manuscriptRoot, "manuscriptRoot");
  const files: ChapterFileMetadata[] = [];

  for (const { book, dir } of BOOK_ROOTS) {
    // Keep the fixed book roots beneath the caller's trusted manuscript root.
    // `lstatSync` deliberately rejects a symlinked book directory: following a
    // link here could make a project index files outside its registered root.
    const bookRoot = resolveInside(root, dir, false);
    if (!bookRoot || !existsSync(bookRoot)) continue;
    const bookRootStat = lstatSync(bookRoot);
    if (!bookRootStat.isDirectory() || bookRootStat.isSymbolicLink()) continue;
    for (const name of readdirSync(bookRoot).sort()) {
      if (!name.toLowerCase().endsWith(".txt")) continue;
      const fullPath = resolveInside(bookRoot, name, false);
      if (!fullPath || !isPathInside(root, fullPath, false)) continue;
      const entryStat = lstatSync(fullPath);
      // Do not follow file symlinks either. This keeps the snapshot's source
      // path physically contained by the registered manuscript root.
      if (entryStat.isSymbolicLink() || !entryStat.isFile()) continue;
      const stat = statSync(fullPath);

      const parsed = parseChapterName(name);
      files.push({
        chapter_id: `${book}/${name}`,
        book,
        rel_path: join(dir, name),
        path: fullPath,
        ...parsed,
        file_mtime: stat.mtime.toISOString(),
        file_size: stat.size,
      });
    }
  }
  return files;
}

/** Hydrate one metadata record with text and its content-derived fields. */
export function readChapterFile(file: ChapterFileMetadata): ChapterFile {
  const text = readFileSync(file.path, "utf-8");
  return {
    ...file,
    text,
    sha256: createHash("sha256").update(text).digest("hex"),
    word_count: text.split(/\s+/).filter(Boolean).length,
  };
}

/** Read every chapter text file from the configured book roots. */
export function scanChapterFiles(options: ChapterSyncOptions | string): ChapterFile[] {
  return scanChapterFileMetadata(options).map(readChapterFile);
}

/** Sync chapter snapshots into the server's existing chapters table. */
export function syncChapters(db: ContentDatabase, options: ChapterSyncOptions | string): ChapterSyncResult {
  const result: ChapterSyncResult = { scanned: 0, added: 0, updated: 0, unchanged: 0, deactivated: 0 };
  const seen = new Set<string>();
  const upsert = db.prepare(`
    INSERT INTO chapters (chapter_id, book, rel_path, number, title, text, sha256,
                          word_count, active, file_mtime, file_size, synced_at)
    VALUES (@chapter_id, @book, @rel_path, @number, @title, @text, @sha256,
            @word_count, 1, @file_mtime, @file_size, @synced_at)
    ON CONFLICT(chapter_id) DO UPDATE SET
      number = excluded.number, title = excluded.title, text = excluded.text,
      sha256 = excluded.sha256, word_count = excluded.word_count, active = 1,
      file_mtime = excluded.file_mtime, file_size = excluded.file_size, synced_at = excluded.synced_at
  `);
  const getMetadata = db.prepare(
    `SELECT active, file_mtime, file_size
     FROM chapters WHERE chapter_id = ?`,
  );
  const reactivate = db.prepare(
    `UPDATE chapters SET book = ?, rel_path = ?, number = ?, title = ?, active = 1,
       file_mtime = ?, file_size = ?, synced_at = ? WHERE chapter_id = ?`,
  );

  for (const metadata of scanChapterFileMetadata(options)) {
    result.scanned++;
    seen.add(metadata.chapter_id);
    const previous = getMetadata.get(metadata.chapter_id) as
      | { active: number; file_mtime: string | null; file_size: number }
      | undefined;
    const metadataUnchanged =
      previous &&
      previous.file_size >= 0 &&
      previous.file_size === metadata.file_size &&
      previous.file_mtime === metadata.file_mtime;
    if (metadataUnchanged && previous.active === 1) {
      result.unchanged++;
      continue;
    }

    // A vanished row can be reactivated from its existing snapshot without
    // reopening the file when the filesystem metadata still matches.
    if (metadataUnchanged && previous.active !== 1) {
      reactivate.run(
        metadata.book,
        metadata.rel_path,
        metadata.number,
        metadata.title,
        metadata.file_mtime,
        metadata.file_size,
        nowIso(),
        metadata.chapter_id,
      );
      result.updated++;
      continue;
    }

    const file = readChapterFile(metadata);

    const { path: _sourcePath, ...row } = file;
    upsert.run({ ...row, synced_at: nowIso() });
    if (previous) result.updated++;
    else result.added++;
  }

  // Keep vanished rows for run history, but make them inactive as before.
  const activeRows = db.prepare("SELECT chapter_id FROM chapters WHERE active = 1").all() as Array<{
    chapter_id: string;
  }>;
  const deactivate = db.prepare("UPDATE chapters SET active = 0, synced_at = ? WHERE chapter_id = ?");
  for (const row of activeRows) {
    if (!seen.has(row.chapter_id)) {
      deactivate.run(nowIso(), row.chapter_id);
      result.deactivated++;
    }
  }
  return result;
}

/** Re-read one chapter from disk before serving a snapshot. */
export function refreshChapter(
  db: ContentDatabase,
  chapterId: string,
  options: ChapterSyncOptions | string,
): boolean {
  const row = db.prepare("SELECT rel_path FROM chapters WHERE chapter_id = ?").get(chapterId) as
    | { rel_path: string }
    | undefined;
  if (!row) return false;

  const root = rootValue(chapterOptions(options).manuscriptRoot, "manuscriptRoot");
  const fullPath = resolveInside(root, row.rel_path, false);
  if (!fullPath || !existsSync(fullPath)) {
    db.prepare("UPDATE chapters SET active = 0, synced_at = ? WHERE chapter_id = ?").run(nowIso(), chapterId);
    return false;
  }

  const text = readFileSync(fullPath, "utf-8");
  const refreshedStat = statSync(fullPath);
  db.prepare(
    `UPDATE chapters SET text = ?, sha256 = ?, word_count = ?, active = 1, file_mtime = ?, file_size = ?, synced_at = ?
     WHERE chapter_id = ?`,
  ).run(
    text,
    createHash("sha256").update(text).digest("hex"),
    text.split(/\s+/).filter(Boolean).length,
    refreshedStat.mtime.toISOString(),
    refreshedStat.size,
    nowIso(),
    chapterId,
  );
  return true;
}
