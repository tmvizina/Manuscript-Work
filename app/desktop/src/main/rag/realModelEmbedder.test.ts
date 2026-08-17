import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAG_EMBEDDING_DIM } from "./embedder.js";

/**
 * Opt-in check that the real model, the hand-written tokenizer, and the
 * pooling maths agree well enough to retrieve anything useful. Unit tests use
 * the deterministic fake; this one loads ~23 MB of weights, so it is skipped
 * unless explicitly requested and the main process has been compiled:
 *
 *   npm --prefix app/desktop run build:main
 *   BOOK_WRITER_RAG_REAL_MODEL=1 npm test
 *
 * It exercises the compiled worker over child-process IPC rather than an
 * Electron utilityProcess, so it needs no display and spawns no window.
 */
const workerPath = resolve(__dirname, "..", "..", "..", "dist", "main", "rag", "utilityEmbedderWorker.js");
const modelDir = resolve(__dirname, "..", "..", "..", "resources", "rag-model");
const modelPath = resolve(modelDir, "model_quantized.onnx");

const enabled = process.env.BOOK_WRITER_RAG_REAL_MODEL === "1" && existsSync(workerPath) && existsSync(modelPath);

function embedWithWorker(texts: string[]): Promise<number[][]> {
  return new Promise((resolvePromise, reject) => {
    const child = fork(workerPath, [], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("the embedding worker did not respond in time"));
    }, 120_000);

    child.on("message", (message: any) => {
      if (message?.type === "initError") {
        clearTimeout(timer);
        child.kill();
        reject(new Error(String(message.message)));
        return;
      }
      if (message?.type === "ready") {
        child.send({ type: "embed", requestId: 1, texts });
        return;
      }
      if (message?.requestId !== 1) return;
      clearTimeout(timer);
      child.kill();
      if (message.type === "error") reject(new Error(String(message.message)));
      else resolvePromise(message.vectors);
    });

    child.send({ type: "init", modelPath, tokenizerDir: modelDir, embeddingDim: RAG_EMBEDDING_DIM });
  });
}

const cosine = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + value * b[index], 0);

describe.skipIf(!enabled)("real model embedding", () => {
  it("produces unit vectors that rank related text above unrelated text", async () => {
    const [dragon, serpent, blade, dragonAgain] = await embedWithWorker([
      "The dragon spread its wings and blotted out the sun.",
      "A great winged serpent darkened the sky above them.",
      "She sharpened the blade against a whetstone by the fire.",
      "The dragon spread its wings and blotted out the sun.",
    ]);

    for (const vector of [dragon, serpent, blade, dragonAgain]) {
      expect(vector).toHaveLength(RAG_EMBEDDING_DIM);
      expect(Math.sqrt(cosine(vector, vector))).toBeCloseTo(1, 4);
    }

    // The ordering is what retrieval depends on; a broken tokenizer or a
    // mispooled output collapses these scores toward each other.
    expect(cosine(dragon, dragonAgain)).toBeCloseTo(1, 4);
    expect(cosine(dragon, serpent)).toBeGreaterThan(cosine(dragon, blade));
    expect(cosine(dragon, serpent)).toBeGreaterThan(0.4);
  }, 180_000);
});
