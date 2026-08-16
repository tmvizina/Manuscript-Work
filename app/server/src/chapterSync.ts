import {
  refreshChapter as refreshContentChapter,
  syncChapters as syncContentChapters,
  type ChapterSyncResult,
} from "../../../packages/core/src/index.js";
import { MANUSCRIPT_ROOT } from "./config.js";
import type { DB } from "./db/db.js";

/** Compatibility adapter for the HTTP server. Filesystem/content behavior
 * lives in @book-writer/core; the server supplies its configured root and DB. */
export type SyncResult = ChapterSyncResult;

export function syncChapters(db: DB): SyncResult {
  return syncContentChapters(db, { manuscriptRoot: MANUSCRIPT_ROOT });
}

export function refreshChapter(db: DB, chapterId: string): boolean {
  return refreshContentChapter(db, chapterId, { manuscriptRoot: MANUSCRIPT_ROOT });
}
