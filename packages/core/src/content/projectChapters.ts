import { existsSync, lstatSync } from "node:fs";
import { sep, resolve } from "node:path";
import { ContentDatabase, nowIso } from "./common.js";
import { ChapterFile, scanChapterFiles } from "./chapters.js";
import { isPathInside, resolveInside, toPosixRelative } from "./paths.js";

/**
 * The only project information the content adapter accepts from its caller.
 * Main-process callers obtain this record from the database (`openProject`);
 * renderer input must never be used to construct it.
 */
export interface TrustedProjectRecord {
  readonly projectId: string;
  readonly rootPath: string;
}

export interface ProjectChapterSyncOptions {
  readonly project: TrustedProjectRecord;
}

export interface ProjectChapterSyncResult {
  scanned: number;
  added: number;
  updated: number;
  unchanged: number;
  deactivated: number;
}

type ProjectInput = TrustedProjectRecord | ProjectChapterSyncOptions;

function trustedProject(input: ProjectInput): TrustedProjectRecord {
  const candidate = input && typeof input === "object" && "project" in input ? input.project : input;
  if (!candidate || typeof candidate !== "object") {
    throw new TypeError("A trusted project record is required for chapter sync");
  }
  if (typeof candidate.projectId !== "string" || candidate.projectId.length === 0 || candidate.projectId.includes("\0")) {
    throw new TypeError("Trusted project is missing a valid projectId");
  }
  if (typeof candidate.rootPath !== "string" || candidate.rootPath.trim().length === 0 || candidate.rootPath.includes("\0")) {
    throw new TypeError("Trusted project is missing a valid rootPath");
  }

  // Project roots are already resolved by the project repository. Resolve a
  // defensive copy here as well so every containment check uses one root.
  return { projectId: candidate.projectId, rootPath: resolve(candidate.rootPath) };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareChapterFiles(left: ChapterFile, right: ChapterFile): number {
  return (
    compareText(left.book, right.book) ||
    left.number - right.number ||
    compareText(left.chapter_id, right.chapter_id)
  );
}

/**
 * Scan one trusted project's manuscript roots and return path-normalized
 * snapshots. The scanner itself rejects symlinked chapter directories/files;
 * these additional checks make the adapter safe even if a future scanner
 * supplies a malformed ChapterFile.
 */
export function scanProjectChapterFiles(input: ProjectInput): ChapterFile[] {
  const project = trustedProject(input);
  // A symlink at the registered root would make lexical containment checks
  // describe a different physical tree. Missing roots are allowed so a sync
  // can deactivate their stale snapshots; an existing symlinked root is not.
  if (existsSync(project.rootPath)) {
    const rootStat = lstatSync(project.rootPath);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return [];
  }
  const files = scanChapterFiles({ manuscriptRoot: project.rootPath });
  const safeFiles: ChapterFile[] = [];

  for (const file of files) {
    const fullPath = resolve(file.path);
    if (!isPathInside(project.rootPath, fullPath, false)) continue;

    const relPath = toPosixRelative(project.rootPath, fullPath);
    const resolvedPath = resolveInside(project.rootPath, relPath.split("/").join(sep), false);
    if (!resolvedPath || resolve(resolvedPath) !== fullPath) continue;

    safeFiles.push({ ...file, path: fullPath, rel_path: relPath });
  }

  return safeFiles.sort(compareChapterFiles);
}

/**
 * Synchronize a trusted project's chapter snapshots into `project_chapters`.
 *
 * This function deliberately does not open or commit a transaction. A desktop
 * caller can invoke it inside its database transaction (and a failed scan
 * occurs before any writes), while callers that do not need atomic batching can
 * use it directly. Only rows scoped by the supplied project ID are read or
 * changed; the legacy `chapters` table is never touched.
 */
export function syncProjectChapters(
  db: ContentDatabase,
  input: ProjectInput,
): ProjectChapterSyncResult {
  const project = trustedProject(input);
  const files = scanProjectChapterFiles(project);
  const result: ProjectChapterSyncResult = {
    scanned: files.length,
    added: 0,
    updated: 0,
    unchanged: 0,
    deactivated: 0,
  };
  const seen = new Set<string>();
  const syncedAt = nowIso();

  const getHash = db.prepare(
    "SELECT sha256, active FROM project_chapters WHERE project_id = ? AND chapter_id = ?",
  );
  const upsert = db.prepare(`
    INSERT INTO project_chapters(
      project_id, chapter_id, book, rel_path, number, title, text, sha256,
      word_count, active, file_mtime, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
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
      synced_at = excluded.synced_at
  `);

  for (const file of files) {
    seen.add(file.chapter_id);
    const previous = getHash.get(project.projectId, file.chapter_id) as
      | { sha256: string; active: number }
      | undefined;
    if (previous && previous.sha256 === file.sha256 && previous.active === 1) {
      result.unchanged++;
      continue;
    }

    upsert.run(
      project.projectId,
      file.chapter_id,
      file.book,
      file.rel_path,
      file.number,
      file.title,
      file.text,
      file.sha256,
      file.word_count,
      file.file_mtime,
      syncedAt,
    );
    if (previous) result.updated++;
    else result.added++;
  }

  // Preserve vanished snapshots for history, but deactivate only this
  // project's rows. A project can legitimately share chapter IDs with any
  // other project in the database.
  const activeRows = db
    .prepare("SELECT chapter_id FROM project_chapters WHERE project_id = ? AND active = 1")
    .all(project.projectId) as Array<{ chapter_id: string }>;
  const deactivate = db.prepare(
    "UPDATE project_chapters SET active = 0, synced_at = ? WHERE project_id = ? AND chapter_id = ?",
  );
  for (const row of activeRows) {
    if (!seen.has(row.chapter_id)) {
      deactivate.run(syncedAt, project.projectId, row.chapter_id);
      result.deactivated++;
    }
  }

  return result;
}
