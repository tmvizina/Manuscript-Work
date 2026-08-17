/**
 * Child-process entry point for embedding.
 *
 * This runs in an Electron `utilityProcess`, never in main. Embedding peaks at
 * hundreds of MB of resident memory; hosting it here means that memory belongs
 * to a process that exits when idle and hands it back to the OS, keeping the
 * app's idle footprint within budget. It also means a fault inside the native
 * ONNX addon takes down a disposable child instead of the user's session.
 *
 * The child does no filesystem discovery and no database work. It receives a
 * verified model directory and text, and returns vectors.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RAG_EMBEDDING_DIM, RAG_MAX_TOKENS, poolAndNormalize } from "./embedder.js";
import { encodeText, parseWordPieceConfig, type WordPieceConfig } from "./wordPiece.js";

interface InitMessage {
  type: "init";
  modelPath: string;
  tokenizerDir: string;
  embeddingDim: number;
}
interface EmbedMessage {
  type: "embed";
  requestId: number;
  texts: string[];
}
type IncomingMessage = InitMessage | EmbedMessage;

let session: any = null;
let tokenizer: WordPieceConfig | null = null;
let dimensions = RAG_EMBEDDING_DIM;

function post(message: unknown): void {
  // utilityProcess gives the child a parentPort; fall back to process.send so
  // the same module can be exercised by a plain child_process in tests.
  const port = (globalThis as any).process?.parentPort;
  if (port && typeof port.postMessage === "function") {
    port.postMessage(message);
    return;
  }
  (process as any).send?.(message);
}

async function initialize(message: InitMessage): Promise<void> {
  dimensions = message.embeddingDim || RAG_EMBEDDING_DIM;
  tokenizer = parseWordPieceConfig(JSON.parse(readFileSync(join(message.tokenizerDir, "tokenizer.json"), "utf8")));

  // Imported lazily and only here: this is the single place in the app that
  // loads the native ONNX runtime.
  const ort = await import("onnxruntime-node");
  const runtime: any = (ort as any).default ?? ort;
  session = await runtime.InferenceSession.create(message.modelPath, {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
  });
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  if (!session || !tokenizer) throw new Error("embedder received work before initialization");

  const ort = await import("onnxruntime-node");
  const runtime: any = (ort as any).default ?? ort;

  const encoded = texts.map((text) => encodeText(text, tokenizer as WordPieceConfig, RAG_MAX_TOKENS).ids);
  const width = Math.max(1, ...encoded.map((ids) => ids.length));
  const batch = encoded.length;

  const inputIds = new BigInt64Array(batch * width);
  const attention = new BigInt64Array(batch * width);
  const tokenTypes = new BigInt64Array(batch * width);
  const masks: number[][] = [];

  for (let row = 0; row < batch; row += 1) {
    const ids = encoded[row];
    const mask: number[] = [];
    for (let column = 0; column < width; column += 1) {
      const inside = column < ids.length;
      inputIds[row * width + column] = BigInt(inside ? ids[column] : 0);
      attention[row * width + column] = BigInt(inside ? 1 : 0);
      tokenTypes[row * width + column] = 0n;
      mask.push(inside ? 1 : 0);
    }
    masks.push(mask);
  }

  const dims = [batch, width];
  const output = await session.run({
    input_ids: new runtime.Tensor("int64", inputIds, dims),
    attention_mask: new runtime.Tensor("int64", attention, dims),
    token_type_ids: new runtime.Tensor("int64", tokenTypes, dims),
  });

  const hidden = output.last_hidden_state;
  const hiddenDim = hidden.dims[hidden.dims.length - 1];
  const data = hidden.data as Float32Array;
  const stride = width * hiddenDim;

  return masks.map((mask, row) => {
    const slice = data.subarray(row * stride, (row + 1) * stride);
    // Structured clone handles typed arrays, but plain arrays keep the message
    // shape explicit and independent of the transport's cloning rules.
    return Array.from(poolAndNormalize(slice, mask, hiddenDim || dimensions));
  });
}

function listen(handler: (message: IncomingMessage) => void): void {
  const port = (globalThis as any).process?.parentPort;
  if (port && typeof port.on === "function") {
    port.on("message", (event: any) => handler(event?.data ?? event));
    return;
  }
  process.on("message", (message) => handler(message as IncomingMessage));
}

listen((message) => {
  void (async () => {
    try {
      if (message.type === "init") {
        await initialize(message);
        post({ type: "ready" });
        return;
      }
      if (message.type === "embed") {
        const vectors = await embedBatch(message.texts);
        post({ type: "result", requestId: message.requestId, vectors });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (message.type === "embed") {
        post({ type: "error", requestId: message.requestId, message: detail });
        return;
      }
      post({ type: "initError", message: detail });
    }
  })();
});
