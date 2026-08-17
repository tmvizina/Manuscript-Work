import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EmbedderChildProcess } from "./utilityEmbedder.js";
import type { VerifiedRagModel } from "./modelManifest.js";

/**
 * Spawns the embedding worker as an Electron `utilityProcess`.
 *
 * Kept apart from `utilityEmbedder.ts` so that the lifecycle rules there —
 * idle exit, crash surfacing, timeouts — stay unit-testable without Electron.
 * This file is the only part of the embedder that needs a real Electron
 * runtime, and it exists purely to adapt `utilityProcess` to the narrow
 * interface the embedder consumes.
 */
export function createRagUtilityProcess(_model: VerifiedRagModel): EmbedderChildProcess {
  // Resolved here rather than at module load: runtime.ts imports this file
  // eagerly, and the Node test runner has no Electron binary to resolve. RAG
  // is the only caller, so nothing outside Electron ever reaches this line.
  const { utilityProcess } = createRequire(import.meta.url)("electron") as typeof import("electron");
  const here = dirname(fileURLToPath(import.meta.url));
  const child = utilityProcess.fork(join(here, "utilityEmbedderWorker.js"), [], {
    // The worker computes vectors from text and nothing else, so it gets no
    // inherited stdio and no window.
    stdio: "ignore",
    serviceName: "book-writer-rag-embedder",
  });

  return {
    postMessage: (message) => child.postMessage(message),
    on: (event: string, listener: (value: any) => void) => {
      if (event === "message") child.on("message", listener);
      else if (event === "exit") child.on("exit", listener);
      // utilityProcess has no 'error' event; a spawn failure surfaces as an
      // immediate exit, which the embedder already treats as a crash.
      return undefined as never;
    },
    kill: () => child.kill(),
  } as EmbedderChildProcess;
}
