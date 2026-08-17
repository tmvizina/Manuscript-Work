import type { DB } from "./db.js";

interface ProjectChapterRow {
  project_id: string;
  chapter_id: string;
  book: string;
  rel_path: string;
  number: number;
  title: string;
  text: string;
  sha256: string;
  word_count: number;
  active: number;
  file_mtime: string | null;
  synced_at: string;
}

export interface ProjectChapterRecord {
  projectId: string;
  chapterId: string;
  book: string;
  relPath: string;
  number: number;
  title: string;
  text: string;
  sha256: string;
  wordCount: number;
  active: boolean;
  fileMtime: string | null;
  syncedAt: string;
}

export type PutProjectChapterInput = ProjectChapterRecord;

const CHAPTER_COLUMNS = `project_id, chapter_id, book, rel_path, number, title, text,
  sha256, word_count, active, file_mtime, synced_at`;

function mapChapter(row: ProjectChapterRow): ProjectChapterRecord {
  return {
    projectId: row.project_id,
    chapterId: row.chapter_id,
    book: row.book,
    relPath: row.rel_path,
    number: row.number,
    title: row.title,
    text: row.text,
    sha256: row.sha256,
    wordCount: row.word_count,
    active: row.active === 1,
    fileMtime: row.file_mtime,
    syncedAt: row.synced_at,
  };
}

export function putProjectChapter(db: DB, chapter: PutProjectChapterInput): void {
  db.prepare(
    `INSERT INTO project_chapters(
       project_id, chapter_id, book, rel_path, number, title, text, sha256,
       word_count, active, file_mtime, synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, chapter_id) DO UPDATE SET
       book = excluded.book,
       rel_path = excluded.rel_path,
       number = excluded.number,
       title = excluded.title,
       text = excluded.text,
       sha256 = excluded.sha256,
       word_count = excluded.word_count,
       active = excluded.active,
       file_mtime = excluded.file_mtime,
       synced_at = excluded.synced_at`,
  ).run(
    chapter.projectId,
    chapter.chapterId,
    chapter.book,
    chapter.relPath,
    chapter.number,
    chapter.title,
    chapter.text,
    chapter.sha256,
    chapter.wordCount,
    chapter.active ? 1 : 0,
    chapter.fileMtime,
    chapter.syncedAt,
  );
}

export function listProjectChapters(db: DB, projectId: string, options: { includeInactive?: boolean } = {}): ProjectChapterRecord[] {
  const rows = (options.includeInactive
    ? db
        .prepare(`SELECT ${CHAPTER_COLUMNS} FROM project_chapters WHERE project_id = ? ORDER BY book, number, chapter_id`)
        .all(projectId)
    : db
        .prepare(`SELECT ${CHAPTER_COLUMNS} FROM project_chapters WHERE project_id = ? AND active = 1 ORDER BY book, number, chapter_id`)
        .all(projectId)) as ProjectChapterRow[];
  return rows.map(mapChapter);
}

export function getProjectChapter(db: DB, projectId: string, chapterId: string): ProjectChapterRecord | null {
  const row = db.prepare(
    `SELECT ${CHAPTER_COLUMNS} FROM project_chapters WHERE project_id = ? AND chapter_id = ?`,
  ).get(projectId, chapterId) as ProjectChapterRow | undefined;
  return row ? mapChapter(row) : null;
}
