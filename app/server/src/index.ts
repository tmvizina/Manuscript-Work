import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { CLAUDE_BRIDGE_URL, DATA_DIR, MANUSCRIPT_ROOT, PORT, RAG_URL, REPO_ROOT } from "./config.js";
import { openDb } from "./db/db.js";
import { resolveOrphanedRuns } from "./claudeRuns.js";
import { syncChapters } from "./chapterSync.js";
import { syncSkills } from "./skillSync.js";
import chapterRoutes from "./routes/chapters.js";
import skillRoutes from "./routes/skills.js";
import claudeRoutes from "./routes/claude.js";
import ragRoutes from "./routes/rag.js";
import helpRoutes from "./routes/help.js";
import worldRoutes from "./routes/world.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const db = openDb(join(DATA_DIR, "bookwriter.db"));
const orphaned = resolveOrphanedRuns(db);
const skillSync = syncSkills(db);
const chapterSync = syncChapters(db);

const app = Fastify({ logger: true });

// Serve the built UI when present (docker/prod); vite dev-server proxies otherwise.
const uiDist = resolve(process.env.BW_UI_DIST ?? join(__dirname, "../../ui/dist"));
const uiPresent = existsSync(join(uiDist, "index.html"));
if (uiPresent) {
  await app.register(fastifyStatic, { root: uiDist });
}
app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not found" });
  if (uiPresent) return (reply as any).sendFile("index.html");
  return reply
    .code(503)
    .header("content-type", "text/html; charset=utf-8")
    .send(`<!doctype html><meta charset="utf-8"><title>Book Writer — UI missing</title>
<body style="font-family:system-ui;max-width:40rem;margin:4rem auto;line-height:1.6">
<h1>API is up, UI build is missing</h1>
<p>The server looked for the built UI at <code>${uiDist}</code> and found nothing.</p>
<ul>
<li><strong>Docker:</strong> rebuild the app image: <code>UI_REBUILD=$(date +%s) docker compose build app &amp;&amp; docker compose up -d</code></li>
<li><strong>Local dev:</strong> run <code>npm run dev</code> in <code>app/ui</code> (UI at :5173),
or build once: <code>cd app/ui &amp;&amp; npm install &amp;&amp; npm run build</code>, then restart.</li>
</ul>
<p>API health: <a href="/api/health">/api/health</a></p></body>`);
});

app.get("/api/health", async () => {
  let rag: any;
  try {
    const r = await fetch(`${RAG_URL}/health`, { signal: AbortSignal.timeout(5_000) });
    rag = await r.json();
  } catch (e: any) {
    rag = { ok: false, error: String(e?.message ?? e) };
  }
  let bridge: any;
  try {
    const r = await fetch(`${CLAUDE_BRIDGE_URL}/health`, { signal: AbortSignal.timeout(5_000) });
    bridge = await r.json();
  } catch (e: any) {
    bridge = { ok: false, error: String(e?.message ?? e) };
  }
  return {
    ok: true,
    repo_root: REPO_ROOT,
    manuscript_root: MANUSCRIPT_ROOT,
    data_dir: DATA_DIR,
    ui: uiPresent ? uiDist : null,
    rag,
    bridge,
  };
});

chapterRoutes(app, db);
skillRoutes(app, db);
claudeRoutes(app, db);
ragRoutes(app, db);
helpRoutes(app);
worldRoutes(app);

app.listen({ port: PORT, host: "0.0.0.0" }).then(() => {
  app.log.info(
    `book-writer server on :${PORT} — skills: ${skillSync.synced} (missing SKILL.md: ${skillSync.missing.join(", ") || "none"}), ` +
      `chapters: +${chapterSync.added} ~${chapterSync.updated} =${chapterSync.unchanged} (manuscript: ${MANUSCRIPT_ROOT})` +
      (orphaned ? `, resolved ${orphaned} orphaned run(s)` : ""),
  );
});
