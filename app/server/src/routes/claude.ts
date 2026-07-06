import type { FastifyInstance } from "fastify";
import { CLAUDE_BRIDGE_TOKEN, CLAUDE_BRIDGE_URL } from "../config.js";
import type { DB } from "../db/db.js";
import { cancelRun, getLiveRun, readTranscript, startRun } from "../claudeRuns.js";

const PERMISSION_MODES = new Set(["default", "acceptEdits", "plan"]);
const RUN_COLS = `run_id, skill_id, variant, prompt, permission_mode, status, result_text, error,
  num_turns, duration_ms, total_cost_usd, input_tokens, output_tokens, created_at, started_at, finished_at`;

export default function claudeRoutes(app: FastifyInstance, db: DB): void {
  app.post("/api/claude/run", async (req, reply) => {
    const body = (req.body ?? {}) as {
      skill_id?: string | null;
      variant?: string;
      prompt?: string;
      permission_mode?: string;
    };
    const userText = String(body.prompt ?? "").trim();
    if (!userText) return reply.code(400).send({ error: "missing prompt" });

    const permissionMode = body.permission_mode || "acceptEdits";
    if (!PERMISSION_MODES.has(permissionMode)) {
      return reply.code(400).send({ error: `permission_mode must be one of: ${[...PERMISSION_MODES].join(", ")}` });
    }

    const variant = body.variant === "rag" ? "rag" : "base";
    let skillId: string | null = null;
    let prompt = userText;
    if (body.skill_id) {
      const skill = db.prepare("SELECT skill_id, has_rag_variant FROM skills WHERE skill_id = ?").get(body.skill_id) as
        | { skill_id: string; has_rag_variant: number }
        | undefined;
      if (!skill) return reply.code(400).send({ error: "unknown skill_id" });
      if (variant === "rag" && !skill.has_rag_variant) {
        return reply.code(400).send({ error: "skill has no RAG-aware variant" });
      }
      skillId = skill.skill_id;
      // Slash commands resolve because the bridge runs claude with cwd = repo root.
      prompt = `/${skillId}${variant === "rag" ? "-rag" : ""} ${userText}`;
    }

    const runId = startRun(db, { skillId, variant, prompt, permissionMode });
    return { run_id: runId };
  });

  app.get("/api/claude/runs", async (req) => {
    const { skill_id, limit } = req.query as { skill_id?: string; limit?: string };
    const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const rows = skill_id
      ? db.prepare(`SELECT ${RUN_COLS} FROM claude_runs WHERE skill_id = ? ORDER BY created_at DESC LIMIT ?`).all(skill_id, n)
      : db.prepare(`SELECT ${RUN_COLS} FROM claude_runs ORDER BY created_at DESC LIMIT ?`).all(n);
    return { runs: rows };
  });

  app.get("/api/claude/runs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.prepare(`SELECT ${RUN_COLS} FROM claude_runs WHERE run_id = ?`).get(id);
    if (!row) return reply.code(404).send({ error: "unknown run" });
    return row;
  });

  /** SSE stream of a run's NDJSON events. Live runs replay the buffer then
   * tail; finished runs replay the transcript file. Ends with event: done. */
  app.get("/api/claude/runs/:id/events", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.prepare("SELECT run_id, status FROM claude_runs WHERE run_id = ?").get(id) as
      | { run_id: string; status: string }
      | undefined;
    if (!row) return reply.code(404).send({ error: "unknown run" });

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.setTimeout(0);
    const send = (line: string) => res.write(`event: claude\ndata: ${line}\n\n`);
    const done = () => {
      res.write(`event: done\ndata: {}\n\n`);
      res.end();
    };

    const run = getLiveRun(id);
    if (!run || run.done) {
      for (const line of run?.events ?? readTranscript(id)) send(line);
      return done();
    }

    for (const line of run.events) send(line);
    const sub = (line: string | null) => (line === null ? done() : send(line));
    run.subscribers.add(sub);
    const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 25_000);
    req.raw.on("close", () => {
      run.subscribers.delete(sub);
      clearInterval(heartbeat);
    });
    res.on("close", () => clearInterval(heartbeat));
  });

  app.post("/api/claude/runs/:id/cancel", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!cancelRun(db, id)) return reply.code(409).send({ error: "run is not active" });
    return { ok: true };
  });

  app.get("/api/claude/bridge/health", async () => {
    try {
      const r = await fetch(`${CLAUDE_BRIDGE_URL}/health`, {
        headers: CLAUDE_BRIDGE_TOKEN ? { authorization: `Bearer ${CLAUDE_BRIDGE_TOKEN}` } : {},
        signal: AbortSignal.timeout(20_000),
      });
      return await r.json();
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e), hint: "Start it: node bridge/claude-bridge.js (see Help → Claude Bridge)" };
    }
  });
}
