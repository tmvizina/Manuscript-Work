import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { EmbedderError, batchTexts, poolAndNormalize, RAG_EMBEDDING_DIM } from "./embedder.js";
import { DeterministicFakeEmbedder } from "./fakeEmbedder.js";
import { UtilityEmbedder, type EmbedderChildProcess } from "./utilityEmbedder.js";
import type { VerifiedRagModel } from "./modelManifest.js";

const MODEL: VerifiedRagModel = {
  modelPath: "C:/installed/resources/rag-model/model_quantized.onnx",
  tokenizerDir: "C:/installed/resources/rag-model",
  modelId: "Xenova/all-MiniLM-L6-v2",
  modelSha256: "a".repeat(64),
  embeddingDim: 4,
};

/** A scriptable stand-in for the utility process. */
class FakeChild extends EventEmitter implements EmbedderChildProcess {
  sent: any[] = [];
  killed = false;
  /** Set to swallow embed requests, simulating a wedged child. */
  silent = false;
  autoReady = true;

  postMessage(message: any): void {
    this.sent.push(message);
    if (message.type === "init" && this.autoReady) {
      queueMicrotask(() => this.emit("message", { type: "ready" }));
      return;
    }
    if (message.type === "embed" && !this.silent) {
      queueMicrotask(() =>
        this.emit("message", {
          type: "result",
          requestId: message.requestId,
          vectors: message.texts.map((_: string, index: number) => [index + 1, 0, 0, 0]),
        }),
      );
    }
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

function utilityEmbedder(child: FakeChild, overrides: Partial<ConstructorParameters<typeof UtilityEmbedder>[0]> = {}) {
  let created = 0;
  const embedder = new UtilityEmbedder({
    model: MODEL,
    createChild: () => {
      created += 1;
      return child;
    },
    idleTimeoutMs: 10,
    requestTimeoutMs: 50,
    batchSize: 2,
    ...overrides,
  });
  return { embedder, createdCount: () => created };
}

describe("embedding helpers", () => {
  it("batches while preserving order", () => {
    expect(batchTexts(["a", "b", "c", "d", "e"], 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(batchTexts([], 8)).toEqual([]);
    expect(batchTexts(["a"], 0)).toEqual([["a"]]);
  });

  it("mean-pools only unmasked tokens and returns a unit vector", () => {
    // Two real tokens plus a padding token whose large values must be ignored.
    // Sum [4,2] over 2 tokens -> mean [2,1] -> unit [2,1]/sqrt(5).
    const states = Float32Array.from([3, 1, 1, 1, 999, 999]);

    const pooled = poolAndNormalize(states, [1, 1, 0], 2);

    expect(pooled[0]).toBeCloseTo(2 / Math.sqrt(5), 6);
    expect(pooled[1]).toBeCloseTo(1 / Math.sqrt(5), 6);
    expect(Math.hypot(...pooled)).toBeCloseTo(1, 6);
  });

  it("leaves an all-zero vector zero rather than dividing by zero", () => {
    // NaNs here would silently poison every later cosine score.
    const pooled = poolAndNormalize(Float32Array.from([0, 0]), [1], 2);

    expect([...pooled]).toEqual([0, 0]);
  });
});

describe("DeterministicFakeEmbedder", () => {
  it("returns stable unit vectors so cosine assertions are exact", async () => {
    const embedder = new DeterministicFakeEmbedder();

    const [first, second] = await embedder.embed(["dragon", "dragon"]);

    expect(first).toEqual(second);
    expect(Math.hypot(...first)).toBeCloseTo(1, 6);
    expect(first).toHaveLength(RAG_EMBEDDING_DIM);
    expect(embedder.embeddedTexts).toEqual(["dragon", "dragon"]);
  });
});

describe("UtilityEmbedder", () => {
  it("initializes once and embeds across batches in order", async () => {
    const child = new FakeChild();
    const { embedder, createdCount } = utilityEmbedder(child);

    const vectors = await embedder.embed(["a", "b", "c"]);

    expect(vectors).toHaveLength(3);
    expect(createdCount()).toBe(1);
    expect(child.sent.filter((message) => message.type === "init")).toHaveLength(1);
    expect(child.sent.filter((message) => message.type === "embed")).toHaveLength(2);
    await embedder.close();
  });

  it("passes the verified model location to the child rather than a guess", async () => {
    const child = new FakeChild();
    const { embedder } = utilityEmbedder(child);

    await embedder.embed(["a"]);

    expect(child.sent[0]).toMatchObject({ type: "init", modelPath: MODEL.modelPath, tokenizerDir: MODEL.tokenizerDir });
    await embedder.close();
  });

  it("exits the child once idle so its memory returns to the OS", async () => {
    // The measured embedding peak exceeds the app's entire idle budget, so a
    // warm model must not be held between bursts of work.
    const child = new FakeChild();
    const { embedder, createdCount } = utilityEmbedder(child);

    await embedder.embed(["a"]);
    expect(child.killed).toBe(false);
    await vi.waitFor(() => expect(child.killed).toBe(true));

    // The next call transparently starts a fresh child.
    const revived = new FakeChild();
    const second = new UtilityEmbedder({
      model: MODEL,
      createChild: () => revived,
      idleTimeoutMs: 10,
      requestTimeoutMs: 50,
    });
    expect(await second.embed(["b"])).toHaveLength(1);
    await second.close();
    expect(createdCount()).toBe(1);
  });

  it("surfaces a crash as a catchable error instead of a leaked rejection", async () => {
    // crashGuards logs unhandled rejections without terminating, so a leaked
    // rejection here would disappear rather than reaching the caller.
    const child = new FakeChild();
    child.autoReady = false;
    const { embedder } = utilityEmbedder(child);

    const pending = embedder.embed(["a"]);
    queueMicrotask(() => child.emit("exit", 3221225477));

    const error = await pending.catch((thrown) => thrown);

    expect(error).toBeInstanceOf(EmbedderError);
    expect((error as EmbedderError).code).toBe("embedder_crashed");
    expect((error as EmbedderError).message).toContain("exited unexpectedly");
    expect(child.killed).toBe(true);
    await embedder.close();
  });

  it("times out a wedged child instead of hanging a reindex forever", async () => {
    const child = new FakeChild();
    child.silent = true;
    const { embedder } = utilityEmbedder(child);

    const error = await embedder.embed(["a"]).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(EmbedderError);
    expect((error as EmbedderError).code).toBe("embedder_timeout");
    expect(child.killed).toBe(true);
    await embedder.close();
  });

  it("rejects a response whose vectors do not match the request", async () => {
    const child = new FakeChild();
    child.postMessage = function (message: any) {
      this.sent.push(message);
      if (message.type === "init") return void queueMicrotask(() => this.emit("message", { type: "ready" }));
      queueMicrotask(() => this.emit("message", { type: "result", requestId: message.requestId, vectors: [[1, 2]] }));
    } as any;
    const { embedder } = utilityEmbedder(child);

    const error = await embedder.embed(["a"]).catch((thrown) => thrown);

    expect((error as EmbedderError).code).toBe("embedder_invalid_response");
    await embedder.close();
  });

  it("reports a worker-side failure without pretending it succeeded", async () => {
    const child = new FakeChild();
    child.postMessage = function (message: any) {
      this.sent.push(message);
      if (message.type === "init") return void queueMicrotask(() => this.emit("message", { type: "ready" }));
      queueMicrotask(() => this.emit("message", { type: "error", requestId: message.requestId, message: "onnx failed" }));
    } as any;
    const { embedder } = utilityEmbedder(child);

    const error = await embedder.embed(["a"]).catch((thrown) => thrown);

    expect((error as EmbedderError).code).toBe("embedder_failed");
    await embedder.close();
  });

  it("refuses work after close", async () => {
    const child = new FakeChild();
    const { embedder } = utilityEmbedder(child);
    await embedder.close();

    await expect(embedder.embed(["a"])).rejects.toMatchObject({ code: "embedder_closed" });
  });

  it("returns an empty result without starting a process", async () => {
    const child = new FakeChild();
    const { embedder, createdCount } = utilityEmbedder(child);

    expect(await embedder.embed([])).toEqual([]);
    expect(createdCount()).toBe(0);
  });
});
