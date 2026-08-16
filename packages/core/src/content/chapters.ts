import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ContentDatabase, nowIso, rootValue } from "./common.js";
import { resolveInside } from "./paths.js";

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
}

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

/** Read every chapter text file from the configured book roots. */
export function scanChapterFiles(options: ChapterSyncOptions | string): ChapterFile[] {
  const { manuscriptRoot } = chapterOptions(options);
  const root = rootValue(manuscriptRoot, "manuscriptRoot");
  const files: ChapterFile[] = [];

  for (const { book, dir } of BOOK_ROOTS) {
    const bookRoot = join(root, dir);
    if (!existsSync(bookRoot)) continue;
    for (const name of readdirSync(bookRoot).sort()) {
      if (!name.toLowerCase().endsWith(".txt")) continue;
      const fullPath = join(bookRoot, name);
      const stat = statSync(fullPath);
      if (!stat.isFile()) continue;

      const text = readFileSync(fullPath, "utf-8");
      const hash = createHash("sha256").update(text).digest("hex");
      const parsed = parseChapterName(name);
      files.push({
        chapter_id: `${book}/${name}`,
        book,
        rel_path: join(dir, name),
        path: fullPath,
        ...parsed,
        text,
        sha256: hash,
        word_count: text.split(/\s+/).filter(Boolean).length,
        file_mtime: stat.mtime.toISOString(),
      });
    }
  }
  return files;
}

/** Sync chapter snapshots into the server's existing chapters table. */
export function syncChapters(db: ContentDatabase, options: ChapterSyncOptions | string): ChapterSyncResult {
  const result: ChapterSyncResult = { scanned: 0, added: 0, updated: 0, unchanged: 0, deactivated: 0 };
  const seen = new Set<string>();
  const upsert = db.prepare(`
    INSERT INTO chapters (chapter_id, book, rel_path, number, title, text, sha256,
                          word_count, active, file_mtime, synced_at)
    VALUES (@chapter_id, @book, @rel_path, @number, @title, @text, @sha256,
            @word_count, 1, @file_mtime, @synced_at)
    ON CONFLICT(chapter_id) DO UPDATE SET
      number = excluded.number, title = excluded.title, text = excluded.text,
      sha256 = excluded.sha256, word_count = excluded.word_count, active = 1,
      file_mtime = excluded.file_mtime, synced_at = excluded.synced_at
  `);
  const getHash = db.prepare("SELECT sha256, active FROM chapters WHERE chapter_id = ?");

  for (const file of scanChapterFiles(options)) {
    result.scanned++;
    seen.add(file.chapter_id);
    const previous = getHash.get(file.chapter_id) as { sha256: string; active: number } | undefined;
    if (previous && previous.sha256 === file.sha256 && previous.active === 1) {
      result.unchanged++;
      continue;
    }

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
  db.prepare(
    `UPDATE chapters SET text = ?, sha256 = ?, word_count = ?, active = 1, file_mtime = ?, synced_at = ?
     WHERE chapter_id = ?`,
  ).run(
    text,
    createHash("sha256").update(text).digest("hex"),
    text.split(/\s+/).filter(Boolean).length,
    statSync(fullPath).mtime.toISOString(),
    nowIso(),
    chapterId,
  );
  return true;
}
