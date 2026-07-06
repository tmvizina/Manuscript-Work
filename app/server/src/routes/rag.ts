import type { FastifyInstance } from "fastify";
import { RAG_URL } from "../config.js";
import { newId, nowIso, type DB } from "../db/db.js";
import { createServerJob, getServerJob } from "../jobsStore.js";

let countTokens: (s: string) => number;
try {
  ({ countTokens } = await import("gpt-tokenizer"));
} catch {
  countTokens = (s) => Math.max(1, Math.ceil(s.length / 4));
}

export default function ragRoutes(app: FastifyInstance, db: DB): void {
  app.get("/api/rag/health", async () => {
    try {
      const r = await fetch(`${RAG_URL}/health`, { signal: AbortSignal.timeout(10_000) });
      return await r.json();
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  app.post("/api/rag/query", async (req, reply) => {
    const body = (req.body ?? {}) as { q?: string; k?: number };
    const q = String(body.q ?? "").trim();
    const k = Math.min(Math.max(Number(body.k) || 5, 1), 20);
    if (!q) return reply.code(400).send({ ok: false, error: "missing q" });

    const source = req.headers["x-rag-source"] === "skill" ? "skill" : req.headers["x-rag-source"] ? "other" : "ui";
    const t0 = Date.now();
    const log = db.prepare(`
      INSERT INTO rag_queries (query_id, q, k, source, ok, error, result_count, total_tokens, latency_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      const r = await fetch(`${RAG_URL}/query?q=${encodeURIComponent(q)}&k=${k}`, {
        signal: AbortSignal.timeout(120_000),
      });
      const data = (await r.json()) as any;
      if (!r.ok || data.ok === false) throw new Error(data.error || `rag service ${r.status}`);

      const results = (data.results ?? []).map((x: any) => ({ ...x, tokens: countTokens(String(x.text ?? "")) }));
      const totalTokens = results.reduce((a: number, b: any) => a + b.tokens, 0);
      const latency = Date.now() - t0;
      log.run(newId("q"), q, k, source, 1, null, results.length, totalTokens, latency, nowIso());
      return { ok: true, q, k, latency_ms: latency, total_tokens: totalTokens, results };
    } catch (e: any) {
      const err = String(e?.message ?? e);
      log.run(newId("q"), q, k, source, 0, err, null, null, Date.now() - t0, nowIso());
      return reply.code(502).send({ ok: false, error: err });
    }
  });

  app.get("/api/rag/queries", async () => ({
    queries: db
      .prepare(
        `SELECT query_id, q, k, source, ok, error, result_count, total_tokens, latency_ms, created_at
         FROM rag_queries ORDER BY created_at DESC LIMIT 50`,
      )
      .all(),
  }));

  // Rebuild is minutes on a full book — wrap it in a pollable job.
  app.post("/api/rag/ingest", async () => {
    const job = createServerJob("rag-ingest", async (update) => {
      update(0.1, "re-scanning corpus and rebuilding the index…");
      const r = await fetch(`${RAG_URL}/ingest`, {
        method: "POST",
        signal: AbortSignal.timeout(30 * 60 * 1000),
      });
      const data = (await r.json()) as any;
      if (!r.ok || data.ok === false) throw new Error(data.error || `rag service ${r.status}`);
      return data;
    });
    return { job_id: job.id };
  });

  app.get("/api/jobs/:id", async (req, reply) => {
    const job = getServerJob((req.params as { id: string }).id);
    if (!job) return reply.code(404).send({ error: "unknown job" });
    return job;
  });
}
