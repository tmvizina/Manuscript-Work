import { randomUUID } from "node:crypto";
import type { DB, TrustedProjectRecord } from "@book-writer/core";
import { BookWriterError, IPC_ERROR_CODES } from "../../shared/errors.js";
import {
  RAG_LIMITS,
  type RagProgressEvent,
  type RagQueryResponse,
  type RagReindexAccepted,
  type RagStatus,
} from "../../shared/contracts.js";
import type { Embedder } from "./embedder.js";
import { RagIndexer } from "./indexer.js";
import type { VerifiedRagModel } from "./modelManifest.js";

export interface RagServiceOptions {
  db: DB;
  /**
   * Built lazily so a launch never pays for the model, and so a build without
   * bundled weights degrades to "unavailable" instead of failing at startup.
   */
  createEmbedder: () => Embedder;
  resolveModel: () => VerifiedRagModel;
}

interface ActiveJob {
  projectId: string;
  cancel: { cancelled: boolean };
  done: Promise<void>;
}

type Subscriber = { subscriptionId: string; projectId: string; deliver: (event: RagProgressEvent) => void };

/**
 * Owns the RAG index lifecycle for the main process: one reindex at a time per
 * project, progress fan-out to subscribed renderers, and cancellation.
 *
 * The model and embedder are resolved on first use rather than at construction
 * so that a build shipped without the weights still answers `status` with
 * `available: false` instead of throwing during startup.
 */
export class RagService {
  private readonly db: DB;
  private readonly createEmbedder: () => Embedder;
  private readonly resolveModel: () => VerifiedRagModel;
  private readonly jobs = new Map<string, ActiveJob>();
  private readonly subscribers = new Map<string, Subscriber>();
  private embedder: Embedder | null = null;
  private indexer: RagIndexer | null = null;
  private unavailableReason: string | null = null;

  constructor(options: RagServiceOptions) {
    this.db = options.db;
    this.createEmbedder = options.createEmbedder;
    this.resolveModel = options.resolveModel;
  }

  /** Resolve the indexer, or null when this build cannot embed. */
  private ensureIndexer(): RagIndexer | null {
    if (this.indexer) return this.indexer;
    if (this.unavailableReason !== null) return null;
    try {
      const model = this.resolveModel();
      this.embedder = this.createEmbedder();
      this.indexer = new RagIndexer({ db: this.db, embedder: this.embedder, model });
      return this.indexer;
    } catch (error) {
      // Remembered so a missing or tampered model is reported once as an
      // unavailable feature rather than retried on every call.
      this.unavailableReason = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  status(projectId: string): RagStatus {
    const indexer = this.ensureIndexer();
    const state = (indexer ?? new RagIndexer({ db: this.db, embedder: nullEmbedder, model: PLACEHOLDER_MODEL })).status(projectId);
    return {
      projectId,
      status: state.status,
      totalFiles: state.totalFiles,
      totalChunks: state.totalChunks,
      modelId: state.modelId,
      lastIndexedAt: state.lastIndexedAt,
      lastError: state.lastError,
      available: indexer !== null,
    };
  }

  async query(projectId: string, query: string, k?: number): Promise<RagQueryResponse> {
    const indexer = this.requireIndexer("rag.query");
    const limit = k ?? RAG_LIMITS.defaultK;
    const results = await indexer.query(projectId, query, limit);
    return {
      projectId,
      query,
      k: limit,
      results: results.map((result) => ({
        chunkId: result.chunkId,
        relPath: result.relPath,
        book: result.book,
        heading: result.heading,
        text: result.text,
        score: result.score,
      })),
    };
  }

  /**
   * Start a reindex and return immediately. Progress arrives through
   * subscriptions; a second call while one is running is a no-op rather than a
   * second pass over the same corpus.
   */
  reindex(project: TrustedProjectRecord): RagReindexAccepted {
    const indexer = this.requireIndexer("rag.reindex");
    const existing = this.jobs.get(project.projectId);
    if (existing) return { projectId: project.projectId, status: "indexing" };

    const cancel = { cancelled: false };
    const done = indexer
      .reindex(project, {
        signal: cancel,
        onProgress: (progress) => {
          this.publish({
            projectId: project.projectId,
            status: "indexing",
            filesTotal: progress.filesTotal,
            filesIndexed: progress.filesIndexed,
            chunksEmbedded: progress.chunksEmbedded,
            currentPath: progress.currentPath,
            error: null,
          });
        },
      })
      .then((result) => {
        this.publish({
          projectId: project.projectId,
          status: result.status,
          filesTotal: result.filesIndexed,
          filesIndexed: result.filesIndexed,
          chunksEmbedded: result.chunksEmbedded,
          currentPath: null,
          error: result.error ?? null,
        });
      })
      .catch((error) => {
        // reindex() already records failure state; this only covers a throw
        // escaping it, which must not become an unhandled rejection.
        this.publish({
          projectId: project.projectId,
          status: "failed",
          filesTotal: 0,
          filesIndexed: 0,
          chunksEmbedded: 0,
          currentPath: null,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.jobs.delete(project.projectId);
      });

    this.jobs.set(project.projectId, { projectId: project.projectId, cancel, done });
    return { projectId: project.projectId, status: "indexing" };
  }

  /**
   * Cancellation is cooperative: the run stops at its next file or batch
   * boundary, so this still reports `indexing`. The `cancelled` status arrives
   * as a progress event once the run actually stops, which is also when
   * whatever it committed becomes final.
   */
  cancel(projectId: string): RagReindexAccepted {
    const job = this.jobs.get(projectId);
    if (!job) return { projectId, status: this.status(projectId).status };
    job.cancel.cancelled = true;
    return { projectId, status: "indexing" };
  }

  subscribe(projectId: string, deliver: (event: RagProgressEvent) => void): string {
    const subscriptionId = `ragsub_${randomUUID()}`;
    this.subscribers.set(subscriptionId, { subscriptionId, projectId, deliver });
    return subscriptionId;
  }

  unsubscribe(subscriptionId: string): boolean {
    return this.subscribers.delete(subscriptionId);
  }

  async shutdown(): Promise<void> {
    for (const job of this.jobs.values()) job.cancel.cancelled = true;
    await Promise.allSettled([...this.jobs.values()].map((job) => job.done));
    this.subscribers.clear();
    await this.embedder?.close();
  }

  private requireIndexer(operation: string): RagIndexer {
    const indexer = this.ensureIndexer();
    if (!indexer) {
      throw new BookWriterError({
        code: IPC_ERROR_CODES.featureUnavailable,
        message: "Semantic search is not available in this build",
        operation,
      });
    }
    return indexer;
  }

  private publish(event: RagProgressEvent): void {
    for (const subscriber of this.subscribers.values()) {
      if (subscriber.projectId !== event.projectId) continue;
      try {
        subscriber.deliver(event);
      } catch {
        // A dead renderer must not stop an index or other subscribers.
      }
    }
  }
}

/** Stand-in used only to read persisted status when no model is available. */
const nullEmbedder: Embedder = {
  embed: async () => {
    throw new Error("no embedder");
  },
  close: async () => {},
};

const PLACEHOLDER_MODEL: VerifiedRagModel = {
  modelPath: "",
  tokenizerDir: "",
  modelId: "",
  modelSha256: "",
  embeddingDim: 0,
};
