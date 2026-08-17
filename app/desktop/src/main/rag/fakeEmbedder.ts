import { RAG_EMBEDDING_DIM, type Embedder } from "./embedder.js";

/**
 * A deterministic stand-in for the real model, used by every test that is not
 * explicitly opted into loading ~23 MB of weights.
 *
 * Vectors are derived from the text alone, so cosine assertions elsewhere are
 * exact and reproducible: identical strings score 1, and strings mapped to
 * different basis dimensions score 0. Excluded from packaged builds, the same
 * as the fake provider runner.
 */
export class DeterministicFakeEmbedder implements Embedder {
  embedCalls = 0;
  embeddedTexts: string[] = [];
  closed = false;
  /** Set to make embed() reject, exercising caller error handling. */
  failure: Error | null = null;

  constructor(private readonly dimensions = RAG_EMBEDDING_DIM) {}

  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    if (this.closed) throw new Error("embedder is closed");
    if (this.failure) throw this.failure;
    this.embedCalls += 1;
    this.embeddedTexts.push(...texts);
    return texts.map((text) => this.vectorFor(text));
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  /**
   * A unit vector on a single basis dimension chosen by a stable hash of the
   * text. Distinct texts are almost always orthogonal (score 0), which makes
   * ranking assertions unambiguous.
   */
  vectorFor(text: string): Float32Array {
    const vector = new Float32Array(this.dimensions);
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
    }
    vector[hash % this.dimensions] = 1;
    return vector;
  }
}
