/**
 * The seam every RAG consumer depends on. Nothing outside utilityEmbedder.ts
 * imports onnxruntime-node, so indexing and query code stays testable with a
 * deterministic fake, the same way the provider subsystem depends on
 * `ProviderRunner` rather than on a real CLI.
 */
export interface Embedder {
  /** Embed texts in order, returning one unit-length vector per input. */
  embed(texts: readonly string[]): Promise<Float32Array[]>;
  /** Release any held process/model resources. Safe to call repeatedly. */
  close(): Promise<void>;
}

/** Dimensionality of the bundled MiniLM model's sentence embeddings. */
export const RAG_EMBEDDING_DIM = 384;

/**
 * Measured at batch=8: as fast as batch=32 while peaking at roughly 40% of the
 * memory. Raising this without re-measuring trades a large amount of resident
 * memory for nothing.
 */
export const RAG_EMBED_BATCH_SIZE = 8;

/** MiniLM's trained positional range; longer inputs are truncated. */
export const RAG_MAX_TOKENS = 256;

export type EmbedderErrorCode =
  | "embedder_unavailable"
  | "embedder_crashed"
  | "embedder_timeout"
  | "embedder_closed"
  | "embedder_failed"
  | "embedder_invalid_response";

/**
 * A bounded, non-secret embedder failure.
 *
 * Every failure path throws this rather than leaking a rejected promise:
 * crashGuards.ts logs unhandled rejections without terminating, so a leaked
 * rejection here would vanish silently instead of surfacing to the caller.
 */
export class EmbedderError extends Error {
  readonly code: EmbedderErrorCode;

  constructor(code: EmbedderErrorCode, message: string) {
    super(message);
    this.name = "EmbedderError";
    this.code = code;
  }
}

/** Split into embedding batches, preserving order. */
export function batchTexts(texts: readonly string[], batchSize = RAG_EMBED_BATCH_SIZE): string[][] {
  const size = Math.max(1, Math.floor(batchSize));
  const batches: string[][] = [];
  for (let index = 0; index < texts.length; index += size) {
    batches.push(texts.slice(index, index + size) as string[]);
  }
  return batches;
}

/** Mean-pool token states under the attention mask, then L2-normalize. */
export function poolAndNormalize(
  tokenStates: Float32Array,
  attentionMask: readonly number[],
  dimensions: number,
): Float32Array {
  const pooled = new Float32Array(dimensions);
  let counted = 0;

  for (let token = 0; token < attentionMask.length; token += 1) {
    if (attentionMask[token] === 0) continue;
    counted += 1;
    const offset = token * dimensions;
    for (let dimension = 0; dimension < dimensions; dimension += 1) {
      pooled[dimension] += tokenStates[offset + dimension];
    }
  }

  if (counted > 0) {
    for (let dimension = 0; dimension < dimensions; dimension += 1) pooled[dimension] /= counted;
  }

  let magnitude = 0;
  for (let dimension = 0; dimension < dimensions; dimension += 1) magnitude += pooled[dimension] * pooled[dimension];
  magnitude = Math.sqrt(magnitude);
  // A zero vector cannot be normalized; leave it zero rather than dividing by
  // zero and producing NaNs that would poison every later cosine score.
  if (magnitude > 0) {
    for (let dimension = 0; dimension < dimensions; dimension += 1) pooled[dimension] /= magnitude;
  }
  return pooled;
}
