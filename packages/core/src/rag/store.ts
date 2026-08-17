import type { DB } from "../db/db.js";
import { nowIso } from "../db/db.js";

/**
 * Raw SQL CRUD for the migration-3 RAG tables (`project_rag_files`,
 * `project_rag_chunks`, `project_rag_index_state`) plus the brute-force
 * cosine top-k search described in the design's §4. Nothing here touches an
 * embedding model: callers supply already-computed `Float32Array` vectors,
 * which keeps this module deterministic and unit-testable on its own.
 */

const FLOAT32_BYTES = 4;

/** Encode a vector as the raw little-endian Float32 BLOB the schema expects. */
export function encodeRagEmbedding(vector: Float32Array): Buffer {
  const buffer = Buffer.alloc(vector.length * FLOAT32_BYTES);
  for (let i = 0; i < vector.length; i++) buffer.writeFloatLE(vector[i], i * FLOAT32_BYTES);
  return buffer;
}

/** Decode a stored embedding BLOB back into a vector, validating its length against `dim`. */
export function decodeRagEmbedding(blob: Buffer | Uint8Array, dim: number): Float32Array {
  const buffer = Buffer.isBuffer(blob) ? blob : Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  const expectedBytes = dim * FLOAT32_BYTES;
  if (buffer.length !== expectedBytes) {
    throw new RangeError(`Embedding blob is ${buffer.length} bytes, expected ${expectedBytes} for dim=${dim}`);
  }
  const vector = new Float32Array(dim);
  for (let i = 0; i < dim; i++) vector[i] = buffer.readFloatLE(i * FLOAT32_BYTES);
  return vector;
}

export interface RagFileMetadata {
  fileMtime: string | null;
  fileSize: number;
}

/** Read the cached mtime/size for one file's row, or null if it has never been indexed. */
export function getRagFileMetadata(db: DB, projectId: string, fileId: string): RagFileMetadata | null {
  const row = db
    .prepare(`SELECT file_mtime, file_size FROM project_rag_files WHERE project_id = ? AND file_id = ?`)
    .get(projectId, fileId) as { file_mtime: string | null; file_size: number } | undefined;
  return row ? { fileMtime: row.file_mtime, fileSize: row.file_size } : null;
}

export interface RagFileUpsertInput {
  fileId: string;
  relPath: string;
  book: string;
  fileMtime: string | null;
  fileSize: number;
  contentSha256: string;
  indexedAt: string;
}

/**
 * Insert or refresh one file's cache row. `chunk_count` always resets to 0
 * here: callers that changed a file's content must delete its stale chunks
 * (`deleteRagChunksForFile`) before calling this, and the real count is
 * restored once `replaceRagFileChunks` embeds and inserts the new ones.
 */
export function upsertRagFile(db: DB, projectId: string, file: RagFileUpsertInput): void {
  db.prepare(`
    INSERT INTO project_rag_files(
      project_id, file_id, rel_path, book, file_mtime, file_size, content_sha256, chunk_count, indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT(project_id, file_id) DO UPDATE SET
      rel_path = excluded.rel_path,
      book = excluded.book,
      file_mtime = excluded.file_mtime,
      file_size = excluded.file_size,
      content_sha256 = excluded.content_sha256,
      chunk_count = 0,
      indexed_at = excluded.indexed_at
  `).run(projectId, file.fileId, file.relPath, file.book, file.fileMtime, file.fileSize, file.contentSha256, file.indexedAt);
}

/** All file IDs currently tracked for a project, used to detect vanished files during a sync. */
export function listRagFileIds(db: DB, projectId: string): string[] {
  const rows = db.prepare(`SELECT file_id FROM project_rag_files WHERE project_id = ?`).all(projectId) as Array<{
    file_id: string;
  }>;
  return rows.map((row) => row.file_id);
}

/**
 * Delete a file's row. `project_rag_chunks` has an ON DELETE CASCADE foreign
 * key back to `project_rag_files`, so this alone removes every chunk that
 * belonged to the file; callers never need to delete chunk rows separately
 * for a file that is being removed outright.
 */
export function deleteRagFile(db: DB, projectId: string, fileId: string): void {
  db.prepare(`DELETE FROM project_rag_files WHERE project_id = ? AND file_id = ?`).run(projectId, fileId);
}

/** Drop a file's existing chunks without touching its `project_rag_files` row. */
export function deleteRagChunksForFile(db: DB, projectId: string, fileId: string): void {
  db.prepare(`DELETE FROM project_rag_chunks WHERE project_id = ? AND file_id = ?`).run(projectId, fileId);
}

export interface RagChunkInsert {
  chunkId: string;
  fileId: string;
  relPath: string;
  book: string;
  heading: string;
  chunkIndex: number;
  text: string;
  charCount: number;
  modelId: string;
  modelSha256: string;
  embeddingDim: number;
  embedding: Float32Array;
}

/**
 * Replace one file's chunk rows atomically and update its cached chunk_count
 * to match. This is the single unit of work an indexer commits per file/batch
 * (design §5's "each returned batch is one committed SQLite transaction"):
 * delete-then-insert happens inside one `db.transaction`, so a crash between
 * the two statements can never leave stale and fresh chunks mixed together.
 */
export function replaceRagFileChunks(db: DB, projectId: string, fileId: string, chunks: readonly RagChunkInsert[]): void {
  const deleteExisting = db.prepare(`DELETE FROM project_rag_chunks WHERE project_id = ? AND file_id = ?`);
  const insert = db.prepare(`
    INSERT INTO project_rag_chunks(
      project_id, chunk_id, file_id, rel_path, book, heading, chunk_index, text, char_count,
      model_id, model_sha256, embedding_dim, embedding, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateChunkCount = db.prepare(`UPDATE project_rag_files SET chunk_count = ? WHERE project_id = ? AND file_id = ?`);
  const createdAt = nowIso();

  const run = db.transaction((rows: readonly RagChunkInsert[]) => {
    deleteExisting.run(projectId, fileId);
    for (const chunk of rows) {
      insert.run(
        projectId,
        chunk.chunkId,
        chunk.fileId,
        chunk.relPath,
        chunk.book,
        chunk.heading,
        chunk.chunkIndex,
        chunk.text,
        chunk.charCount,
        chunk.modelId,
        chunk.modelSha256,
        chunk.embeddingDim,
        encodeRagEmbedding(chunk.embedding),
        createdAt,
      );
    }
    updateChunkCount.run(rows.length, projectId, fileId);
  });
  run(chunks);
}

/**
 * File ids whose chunks are missing. `upsertRagFile` resets `chunk_count` to
 * 0, so this covers new files, files whose text changed, and files a cancelled
 * or failed run never reached — which is what makes resuming an interrupted
 * index just another reindex rather than a special case.
 */
export function listRagFileIdsNeedingChunks(db: DB, projectId: string): string[] {
  const rows = db
    .prepare(`SELECT file_id FROM project_rag_files WHERE project_id = ? AND chunk_count = 0 ORDER BY file_id`)
    .all(projectId) as Array<{ file_id: string }>;
  return rows.map((row) => row.file_id);
}

/** Total chunks currently indexed for a project. */
export function countRagChunks(db: DB, projectId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS total FROM project_rag_chunks WHERE project_id = ?`)
    .get(projectId) as { total: number };
  return row.total;
}

/**
 * Drop every chunk in a project and reset the per-file counts so the next run
 * re-embeds everything. Used when the active model no longer matches the one
 * the stored vectors were produced with: mixing vectors from two models in one
 * cosine comparison yields meaningless scores.
 */
export function clearRagChunksForProject(db: DB, projectId: string): void {
  const run = db.transaction(() => {
    db.prepare(`DELETE FROM project_rag_chunks WHERE project_id = ?`).run(projectId);
    db.prepare(`UPDATE project_rag_files SET chunk_count = 0 WHERE project_id = ?`).run(projectId);
  });
  run();
}

export interface RagSearchCandidate {
  chunkId: string;
  relPath: string;
  book: string;
  heading: string;
  text: string;
  embedding: Float32Array;
}

export interface RagSearchResult {
  chunkId: string;
  relPath: string;
  book: string;
  heading: string;
  text: string;
  score: number;
}

interface RagChunkRow {
  chunk_id: string;
  rel_path: string;
  book: string;
  heading: string;
  text: string;
  embedding_dim: number;
  embedding: Buffer;
}

/** Load and decode every chunk in a project, ready for a brute-force scan. */
export function listRagChunksForSearch(db: DB, projectId: string): RagSearchCandidate[] {
  const rows = db
    .prepare(
      `SELECT chunk_id, rel_path, book, heading, text, embedding_dim, embedding
       FROM project_rag_chunks WHERE project_id = ?`,
    )
    .all(projectId) as RagChunkRow[];
  return rows.map((row) => ({
    chunkId: row.chunk_id,
    relPath: row.rel_path,
    book: row.book,
    heading: row.heading,
    text: row.text,
    embedding: decodeRagEmbedding(row.embedding, row.embedding_dim),
  }));
}

/**
 * Cosine similarity between two equal-length vectors. Returns 0 (rather than
 * NaN) for a zero-magnitude vector so a degenerate embedding cannot poison a
 * sort with NaN comparisons.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new RangeError(`Cannot compare vectors of different dimension (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Brute-force top-k by cosine similarity, per design §4's "brute force wins
 * here" call — a few thousand 384-dim rows is comfortably sub-millisecond in
 * plain JS. Ties break on ascending chunkId so results are deterministic and
 * reproducible in tests, not dependent on array/sort stability quirks.
 */
export function ragTopK(query: Float32Array, candidates: readonly RagSearchCandidate[], k: number): RagSearchResult[] {
  if (!Number.isInteger(k) || k < 1) throw new RangeError("k must be a positive integer");
  const scored = candidates.map((candidate) => ({
    chunkId: candidate.chunkId,
    relPath: candidate.relPath,
    book: candidate.book,
    heading: candidate.heading,
    text: candidate.text,
    score: cosineSimilarity(query, candidate.embedding),
  }));
  scored.sort((a, b) => b.score - a.score || (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0));
  return scored.slice(0, k);
}

/** Search one project's full chunk set for the k closest matches to `queryEmbedding`. */
export function searchRagChunks(db: DB, projectId: string, queryEmbedding: Float32Array, k: number): RagSearchResult[] {
  return ragTopK(queryEmbedding, listRagChunksForSearch(db, projectId), k);
}

export type RagIndexStatus = "never_indexed" | "indexing" | "ready" | "failed" | "cancelled";

export interface RagIndexStateRecord {
  projectId: string;
  status: RagIndexStatus;
  modelId: string | null;
  modelSha256: string | null;
  totalFiles: number;
  totalChunks: number;
  lastIndexedAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

interface RagIndexStateRow {
  project_id: string;
  status: RagIndexStatus;
  model_id: string | null;
  model_sha256: string | null;
  total_files: number;
  total_chunks: number;
  last_indexed_at: string | null;
  last_error: string | null;
  updated_at: string;
}

/** Read a project's persisted index-run status, or null if it has never been recorded. */
export function getRagIndexState(db: DB, projectId: string): RagIndexStateRecord | null {
  const row = db.prepare(`SELECT * FROM project_rag_index_state WHERE project_id = ?`).get(projectId) as
    | RagIndexStateRow
    | undefined;
  if (!row) return null;
  return {
    projectId: row.project_id,
    status: row.status,
    modelId: row.model_id,
    modelSha256: row.model_sha256,
    totalFiles: row.total_files,
    totalChunks: row.total_chunks,
    lastIndexedAt: row.last_indexed_at,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

export type RagIndexStatePatch = Partial<Omit<RagIndexStateRecord, "projectId" | "updatedAt">>;

/** Merge a partial status update into a project's index-state row and persist it. */
export function upsertRagIndexState(db: DB, projectId: string, patch: RagIndexStatePatch): RagIndexStateRecord {
  const existing = getRagIndexState(db, projectId);
  const merged: RagIndexStateRecord = {
    projectId,
    status: patch.status ?? existing?.status ?? "never_indexed",
    modelId: patch.modelId !== undefined ? patch.modelId : (existing?.modelId ?? null),
    modelSha256: patch.modelSha256 !== undefined ? patch.modelSha256 : (existing?.modelSha256 ?? null),
    totalFiles: patch.totalFiles ?? existing?.totalFiles ?? 0,
    totalChunks: patch.totalChunks ?? existing?.totalChunks ?? 0,
    lastIndexedAt: patch.lastIndexedAt !== undefined ? patch.lastIndexedAt : (existing?.lastIndexedAt ?? null),
    lastError: patch.lastError !== undefined ? patch.lastError : (existing?.lastError ?? null),
    updatedAt: nowIso(),
  };
  db.prepare(`
    INSERT INTO project_rag_index_state(
      project_id, status, model_id, model_sha256, total_files, total_chunks, last_indexed_at, last_error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      status = excluded.status,
      model_id = excluded.model_id,
      model_sha256 = excluded.model_sha256,
      total_files = excluded.total_files,
      total_chunks = excluded.total_chunks,
      last_indexed_at = excluded.last_indexed_at,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
  `).run(
    merged.projectId,
    merged.status,
    merged.modelId,
    merged.modelSha256,
    merged.totalFiles,
    merged.totalChunks,
    merged.lastIndexedAt,
    merged.lastError,
    merged.updatedAt,
  );
  return merged;
}
