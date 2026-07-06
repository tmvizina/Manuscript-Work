import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MANUSCRIPT_ROOT } from "./config.js";
import { nowIso, type DB } from "./db/db.js";

/** Book roots under MANUSCRIPT_ROOT (missing roots are skipped — the corpus
 * starts empty for a new book). Mirrors rag/raglib.py's CORPUS_SPECS. */
const BOOK_ROOTS: Array<{ book: string; dir: string }> = [
  { book: "book-1", dir: "chapters" },
  { book: "book-2", dir: join("book-2", "chapters") },
  { book: "prequel", dir: join("prequel-novella", "chapters") },
];

const CHAPTER_RE = /^Chapter\s+(\d+(?:\.\d+)?)\s*-\s*(.+)\.txt$/i;

export interface SyncResult {
  scanned: number;
  added: number;
  updated: number;
  unchanged: number;
  deactivated: number;
}

function parseName(filename: string): { number: number; title: string } {
  const m = CHAPTER_RE.exec(filename);
  if (m) return { number: parseFloat(m[1]), title: m[2].trim() };
  // Defensive: still list files that don't match the convention.
  return { number: 9999, title: filename.replace(/\.txt$/i, "") };
}

/** Scan the manuscript roots and upsert every chapter .txt into SQLite.
 * Hash-based: unchanged files are untouched; vanished files -> active=0. */
export function syncChapters(db: DB): SyncResult {
  const res: SyncResult = { scanned: 0, added: 0, updated: 0, unchanged: 0, deactivated: 0 };
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

  for (const { book, dir } of BOOK_ROOTS) {
    const root = join(MANUSCRIPT_ROOT, dir);
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root).sort()) {
      if (!name.toLowerCase().endsWith(".txt")) continue;
      const full = join(root, name);
      const st = statSync(full);
      if (!st.isFile()) continue;
      res.scanned++;
      const chapterId = `${book}/${name}`;
      seen.add(chapterId);

      const text = readFileSync(full, "utf-8");
      const sha256 = createHash("sha256").update(text).digest("hex");
      const prev = getHash.get(chapterId) as { sha256: string; active: number } | undefined;
      if (prev && prev.sha256 === sha256 && prev.active === 1) {
        res.unchanged++;
        continue;
      }

      const { number, title } = parseName(name);
      upsert.run({
        chapter_id: chapterId,
        book,
        rel_path: join(dir, name),
        number,
        title,
        text,
        sha256,
        word_count: text.split(/\s+/).filter(Boolean).length,
        file_mtime: st.mtime.toISOString(),
        synced_at: nowIso(),
      });
      if (prev) res.updated++;
      else res.added++;
    }
  }

  // Files gone from disk: keep the row (run history may reference it), flag inactive.
  const activeRows = db.prepare("SELECT chapter_id FROM chapters WHERE active = 1").all() as Array<{
    chapter_id: string;
  }>;
  const deactivate = db.prepare("UPDATE chapters SET active = 0, synced_at = ? WHERE chapter_id = ?");
  for (const row of activeRows) {
    if (!seen.has(row.chapter_id)) {
      deactivate.run(nowIso(), row.chapter_id);
      res.deactivated++;
    }
  }
  return res;
}

/** Re-read one chapter's file from disk (if it still exists) before serving. */
export function refreshChapter(db: DB, chapterId: string): boolean {
  const row = db.prepare("SELECT rel_path FROM chapters WHERE chapter_id = ?").get(chapterId) as
    | { rel_path: string }
    | undefined;
  if (!row) return false;
  const full = join(MANUSCRIPT_ROOT, row.rel_path);
  if (!existsSync(full)) {
    db.prepare("UPDATE chapters SET active = 0, synced_at = ? WHERE chapter_id = ?").run(nowIso(), chapterId);
    return false;
  }
  const text = readFileSync(full, "utf-8");
  db.prepare(
    `UPDATE chapters SET text = ?, sha256 = ?, word_count = ?, active = 1, file_mtime = ?, synced_at = ?
     WHERE chapter_id = ?`,
  ).run(
    text,
    createHash("sha256").update(text).digest("hex"),
    text.split(/\s+/).filter(Boolean).length,
    statSync(full).mtime.toISOString(),
    nowIso(),
    chapterId,
  );
  return true;
}
