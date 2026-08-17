import { EmbedderError, RAG_EMBEDDING_DIM, RAG_EMBED_BATCH_SIZE, batchTexts, type Embedder } from "./embedder.js";
import type { VerifiedRagModel } from "./modelManifest.js";

/**
 * The subset of an Electron `utilityProcess` this class uses. Narrowing it to
 * an interface keeps the lifecycle rules — idle exit, crash surfacing, request
 * timeouts — testable without spawning Electron.
 */
export interface EmbedderChildProcess {
  postMessage(message: unknown): void;
  on(event: "message", listener: (message: any) => void): void;
  on(event: "exit", listener: (code: number) => void): void;
  on(event: "error", listener: (error: unknown) => void): void;
  kill(): boolean;
}

export type EmbedderChildFactory = (model: VerifiedRagModel) => EmbedderChildProcess;

export interface UtilityEmbedderOptions {
  model: VerifiedRagModel;
  createChild: EmbedderChildFactory;
  /** Exit the child after this long with no work, returning its memory. */
  idleTimeoutMs?: number;
  /** Upper bound on one batch, so a wedged child cannot hang a reindex. */
  requestTimeoutMs?: number;
  batchSize?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

interface Pending {
  resolve: (vectors: Float32Array[]) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  expected: number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

/**
 * Runs embedding in a short-lived child process.
 *
 * The child is spawned on demand and killed once idle: embedding peaks at
 * hundreds of MB, and the app's whole idle budget is smaller than that, so
 * holding a warm model would blow the budget while the user is just typing.
 * Re-spawning costs a model load (~200 ms), which is the right trade for a
 * feature used in bursts.
 */
export class UtilityEmbedder implements Embedder {
  private child: EmbedderChildProcess | null = null;
  private ready: Promise<void> | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextRequestId = 1;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  private readonly idleTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly batchSize: number;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;

  constructor(private readonly options: UtilityEmbedderOptions) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.batchSize = options.batchSize ?? RAG_EMBED_BATCH_SIZE;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  }

  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    if (this.closed) throw new EmbedderError("embedder_closed", "The embedder has been closed");
    if (texts.length === 0) return [];

    this.cancelIdleTimer();
    try {
      const vectors: Float32Array[] = [];
      for (const batch of batchTexts(texts, this.batchSize)) {
        await this.ensureReady();
        vectors.push(...(await this.sendBatch(batch)));
      }
      return vectors;
    } finally {
      // Start the countdown even on failure; a failed batch should not pin the
      // child's memory indefinitely.
      this.scheduleIdleExit();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.cancelIdleTimer();
    this.teardown(new EmbedderError("embedder_closed", "The embedder has been closed"));
  }

  private async ensureReady(): Promise<void> {
    if (this.child && this.ready) return this.ready;

    let child: EmbedderChildProcess;
    try {
      child = this.options.createChild(this.options.model);
    } catch (error) {
      throw new EmbedderError("embedder_unavailable", `The embedding process could not be started: ${describe(error)}`);
    }
    this.child = child;

    this.ready = new Promise<void>((resolve, reject) => {
      const settleTimer = this.setTimeoutFn(() => {
        reject(new EmbedderError("embedder_timeout", "The embedding process did not become ready in time"));
        this.teardown(new EmbedderError("embedder_timeout", "The embedding process did not become ready in time"));
      }, this.requestTimeoutMs);

      child.on("message", (message: any) => {
        if (message?.type === "ready") {
          this.clearTimeoutFn(settleTimer);
          resolve();
          return;
        }
        if (message?.type === "initError") {
          const error = new EmbedderError("embedder_failed", `The embedding process failed to load the model: ${String(message.message)}`);
          this.clearTimeoutFn(settleTimer);
          reject(error);
          this.teardown(error);
          return;
        }
        this.handleMessage(message);
      });

      child.on("error", (error: unknown) => {
        const wrapped = new EmbedderError("embedder_crashed", `The embedding process failed: ${describe(error)}`);
        this.clearTimeoutFn(settleTimer);
        reject(wrapped);
        this.teardown(wrapped);
      });

      child.on("exit", (code: number) => {
        // An expected idle exit has already cleared child/pending state; this
        // only matters when the process died with work outstanding.
        const wrapped = new EmbedderError("embedder_crashed", `The embedding process exited unexpectedly (code ${code})`);
        this.clearTimeoutFn(settleTimer);
        reject(wrapped);
        this.teardown(wrapped);
      });

      child.postMessage({
        type: "init",
        modelPath: this.options.model.modelPath,
        tokenizerDir: this.options.model.tokenizerDir,
        embeddingDim: this.options.model.embeddingDim || RAG_EMBEDDING_DIM,
      });
    });

    return this.ready;
  }

  private sendBatch(texts: string[]): Promise<Float32Array[]> {
    const child = this.child;
    if (!child) return Promise.reject(new EmbedderError("embedder_unavailable", "The embedding process is not running"));

    const requestId = this.nextRequestId++;
    return new Promise<Float32Array[]>((resolve, reject) => {
      const timer = this.setTimeoutFn(() => {
        this.pending.delete(requestId);
        const error = new EmbedderError("embedder_timeout", "The embedding process did not respond in time");
        // A child that stopped answering is not trustworthy for later batches.
        this.teardown(error);
        reject(error);
      }, this.requestTimeoutMs);

      this.pending.set(requestId, { resolve, reject, timer, expected: texts.length });
      try {
        child.postMessage({ type: "embed", requestId, texts });
      } catch (error) {
        this.pending.delete(requestId);
        this.clearTimeoutFn(timer);
        reject(new EmbedderError("embedder_crashed", `The embedding request could not be sent: ${describe(error)}`));
      }
    });
  }

  private handleMessage(message: any): void {
    if (typeof message?.requestId !== "number") return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    this.clearTimeoutFn(pending.timer);

    if (message.type === "error") {
      pending.reject(new EmbedderError("embedder_failed", `Embedding failed: ${String(message.message)}`));
      return;
    }
    if (message.type !== "result" || !Array.isArray(message.vectors) || message.vectors.length !== pending.expected) {
      pending.reject(new EmbedderError("embedder_invalid_response", "The embedding process returned an unexpected response"));
      return;
    }
    const dimensions = this.options.model.embeddingDim || RAG_EMBEDDING_DIM;
    const vectors: Float32Array[] = [];
    for (const entry of message.vectors) {
      if (!Array.isArray(entry) || entry.length !== dimensions) {
        pending.reject(new EmbedderError("embedder_invalid_response", "The embedding process returned a vector of the wrong size"));
        return;
      }
      vectors.push(Float32Array.from(entry));
    }
    pending.resolve(vectors);
  }

  private scheduleIdleExit(): void {
    this.cancelIdleTimer();
    if (this.closed || !this.child || this.pending.size > 0) return;
    this.idleTimer = this.setTimeoutFn(() => {
      this.idleTimer = null;
      // Nothing is outstanding, so this is a clean release rather than a
      // failure; pending rejection would be a no-op either way.
      this.teardown(new EmbedderError("embedder_closed", "The embedding process was released after being idle"));
    }, this.idleTimeoutMs);
  }

  private cancelIdleTimer(): void {
    if (this.idleTimer === null) return;
    this.clearTimeoutFn(this.idleTimer);
    this.idleTimer = null;
  }

  /** Drop the child and fail everything still waiting on it. */
  private teardown(error: unknown): void {
    const child = this.child;
    this.child = null;
    this.ready = null;
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const entry of pending) {
      this.clearTimeoutFn(entry.timer);
      entry.reject(error);
    }
    if (child) {
      try {
        child.kill();
      } catch {
        // Already gone; nothing further to do.
      }
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
