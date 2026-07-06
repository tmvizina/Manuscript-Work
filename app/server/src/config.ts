import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** This repo's root (app/server/src -> three up). Overridable for docker (/repo). */
export const REPO_ROOT = resolve(process.env.REPO_ROOT ?? join(__dirname, "../../.."));

/** Where the manuscript lives: chapters/, book-2/chapters/, prequel-novella/chapters/
 * resolve under this root. Defaults to the repo itself — the new book grows here.
 * Point it at another manuscript checkout to browse that instead. */
export const MANUSCRIPT_ROOT = resolve(process.env.MANUSCRIPT_ROOT ?? REPO_ROOT);

export const DATA_DIR = resolve(process.env.BW_DATA_DIR ?? join(__dirname, "../data"));
export const PORT = Number(process.env.BW_PORT ?? 8321);

/** The rag serve.py service (GET /query, GET /health, POST /ingest). */
export const RAG_URL = process.env.RAG_URL ?? "http://localhost:8801";

/** The host-side claude bridge (bridge/claude-bridge.js). */
export const CLAUDE_BRIDGE_URL = process.env.CLAUDE_BRIDGE_URL ?? "http://localhost:8412";
export const CLAUDE_BRIDGE_TOKEN = process.env.CLAUDE_BRIDGE_TOKEN ?? "";

/** Hard ceiling for a single claude -p run. */
export const CLAUDE_TIMEOUT_MS = Number(process.env.BW_CLAUDE_TIMEOUT_MS ?? 30 * 60 * 1000);
