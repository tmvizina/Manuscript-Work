import {
  chunkRagFile,
  clearRagChunksForProject,
  countRagChunks,
  getRagIndexState,
  listRagFileIdsNeedingChunks,
  readRagCorpusFile,
  replaceRagFileChunks,
  searchRagChunks,
  syncRagCorpusFiles,
  upsertRagIndexState,
  type DB,
  type RagChunkInsert,
  type RagIndexStateRecord,
  type RagSearchResult,
  type TrustedProjectRecord,
} from "@book-writer/core";
import { EmbedderError, RAG_EMBED_BATCH_SIZE, type Embedder } from "./embedder.js";
import type { VerifiedRagModel } from "./modelManifest.js";

export interface RagIndexProgress {
  filesTotal: number;
  filesIndexed: number;
  chunksEmbedded: number;
  currentPath: string | null;
}

export interface RagIndexRunResult {
  status: "ready" | "cancelled" | "failed";
  filesIndexed: number;
  chunksEmbedded: number;
  totalChunks: number;
  error?: string;
}

export interface RagIndexerOptions {
  db: DB;
  embedder: Embedder;
  model: VerifiedRagModel;
  batchSize?: number;
}

/**
 * Joins corpus discovery, chunking, embedding, and vector storage into one
 * cancellable pass.
 *
 * Two properties matter more than throughput here:
 *
 * Cancellation stops early, it never rolls back. Each file is committed whole
 * once its chunks are embedded, so an interrupted run leaves a valid, smaller
 * index rather than a corrupt one — and because a file with no chunks is what
 * marks it as pending, resuming is just another reindex.
 *
 * Queries stay answerable throughout. A file's old chunks are replaced only
 * after its new vectors exist, so a search running mid-index sees either the
 * previous vectors or the new ones, never a mix within one file.
 */
export class RagIndexer {
  private readonly db: DB;
  private readonly embedder: Embedder;
  private readonly model: VerifiedRagModel;
  private readonly batchSize: number;

  constructor(options: RagIndexerOptions) {
    this.db = options.db;
    this.embedder = options.embedder;
    this.model = options.model;
    this.batchSize = options.batchSize ?? RAG_EMBED_BATCH_SIZE;
  }

  status(projectId: string): RagIndexStateRecord {
    return (
      getRagIndexState(this.db, projectId) ?? {
        projectId,
        status: "never_indexed",
        modelId: null,
        modelSha256: null,
        totalFiles: 0,
        totalChunks: 0,
        lastIndexedAt: null,
        lastError: null,
        updatedAt: new Date(0).toISOString(),
      }
    );
  }

  /** Embed one query string and return its nearest chunks. */
  async query(projectId: string, text: string, k: number): Promise<RagSearchResult[]> {
    const [vector] = await this.embedder.embed([text]);
    if (!vector) throw new EmbedderError("embedder_invalid_response", "The query could not be embedded");
    return searchRagChunks(this.db, projectId, vector, k);
  }

  async reindex(
    project: TrustedProjectRecord,
    options: { signal?: { cancelled: boolean }; onProgress?: (progress: RagIndexProgress) => void } = {},
  ): Promise<RagIndexRunResult> {
    const { projectId } = project;
    const cancelled = () => options.signal?.cancelled === true;

    // Vectors from a different model cannot be compared with this one's, so a
    // model change invalidates the whole index rather than part of it.
    const previous = getRagIndexState(this.db, projectId);
    if (previous?.modelSha256 && previous.modelSha256 !== this.model.modelSha256) {
      clearRagChunksForProject(this.db, projectId);
    }

    upsertRagIndexState(this.db, projectId, {
      status: "indexing",
      modelId: this.model.modelId,
      modelSha256: this.model.modelSha256,
      lastError: null,
    });

    let filesIndexed = 0;
    let chunksEmbedded = 0;

    try {
      const sync = syncRagCorpusFiles(this.db, project);
      const pendingIds = new Set(listRagFileIdsNeedingChunks(this.db, projectId));
      const pending = sync.files.filter((file) => pendingIds.has(file.fileId));

      options.onProgress?.({ filesTotal: pending.length, filesIndexed: 0, chunksEmbedded: 0, currentPath: null });

      for (const file of pending) {
        if (cancelled()) return this.finish(projectId, "cancelled", filesIndexed, chunksEmbedded, sync.scanned);

        const hydrated = readRagCorpusFile(file);
        const drafts = chunkRagFile(hydrated);
        const inserts: RagChunkInsert[] = [];

        for (let offset = 0; offset < drafts.length; offset += this.batchSize) {
          if (cancelled()) return this.finish(projectId, "cancelled", filesIndexed, chunksEmbedded, sync.scanned);
          const batch = drafts.slice(offset, offset + this.batchSize);
          const vectors = await this.embedder.embed(batch.map((draft) => draft.text));
          batch.forEach((draft, index) => {
            inserts.push({
              chunkId: draft.chunkId,
              fileId: draft.fileId,
              relPath: draft.relPath,
              book: draft.book,
              heading: draft.heading,
              chunkIndex: draft.chunkIndex,
              text: draft.text,
              charCount: draft.charCount,
              modelId: this.model.modelId,
              modelSha256: this.model.modelSha256,
              embeddingDim: this.model.embeddingDim,
              embedding: vectors[index],
            });
          });
        }

        // Commit the file as a unit. Committing per batch would leave a file
        // half-indexed and, since chunk_count would be non-zero, wrongly
        // considered complete by the next run.
        replaceRagFileChunks(this.db, projectId, file.fileId, inserts);
        filesIndexed += 1;
        chunksEmbedded += inserts.length;
        options.onProgress?.({
          filesTotal: pending.length,
          filesIndexed,
          chunksEmbedded,
          currentPath: file.relPath,
        });
      }

      return this.finish(projectId, "ready", filesIndexed, chunksEmbedded, sync.scanned);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Whatever committed before the failure stays queryable; a failed
      // reindex must not discard a working index.
      const state = this.finish(projectId, "failed", filesIndexed, chunksEmbedded, undefined, message);
      return state;
    }
  }

  private finish(
    projectId: string,
    status: "ready" | "cancelled" | "failed",
    filesIndexed: number,
    chunksEmbedded: number,
    totalFiles?: number,
    error?: string,
  ): RagIndexRunResult {
    const totalChunks = countRagChunks(this.db, projectId);
    upsertRagIndexState(this.db, projectId, {
      status,
      totalChunks,
      ...(totalFiles === undefined ? {} : { totalFiles }),
      lastError: error ?? null,
      ...(status === "ready" ? { lastIndexedAt: new Date().toISOString() } : {}),
    });
    return { status, filesIndexed, chunksEmbedded, totalChunks, ...(error ? { error } : {}) };
  }
}
