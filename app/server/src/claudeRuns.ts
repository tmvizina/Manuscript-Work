/** The claude -p run engine: submits prompts to the host-side bridge, relays
 * its NDJSON stream to (a) a transcript file, (b) any attached SSE clients,
 * and (c) the claude_runs row once the result event arrives.
 *
 * Live runs keep an in-memory event buffer so an SSE client attaching late
 * (or reconnecting) replays everything before tailing. Finished runs replay
 * from the transcript file instead. */
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CLAUDE_BRIDGE_TOKEN, CLAUDE_BRIDGE_URL, CLAUDE_TIMEOUT_MS, DATA_DIR } from "./config.js";
import { newId, nowIso, type DB } from "./db/db.js";

export interface LiveRun {
  runId: string;
  events: string[]; // raw NDJSON lines, replayed to late subscribers
  subscribers: Set<(line: string | null) => void>; // null = stream ended
  abort: AbortController;
  done: boolean;
}

const live = new Map<string, LiveRun>();

export function getLiveRun(runId: string): LiveRun | undefined {
  return live.get(runId);
}

export function transcriptFile(runId: string): string {
  return join(DATA_DIR, "runs", `${runId}.ndjson`);
}

/** Read a finished run's raw NDJSON lines (for SSE replay after restart). */
export function readTranscript(runId: string): string[] {
  const file = transcriptFile(runId);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8").split("\n").filter(Boolean);
}

export function startRun(
  db: DB,
  opts: { skillId: string | null; variant: "base" | "rag"; prompt: string; permissionMode: string },
): string {
  const runId = newId("run");
  mkdirSync(join(DATA_DIR, "runs"), { recursive: true });

  db.prepare(
    `INSERT INTO claude_runs (run_id, skill_id, variant, prompt, permission_mode, status, transcript_path, created_at)
     VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`,
  ).run(runId, opts.skillId, opts.variant, opts.prompt, opts.permissionMode, transcriptFile(runId), nowIso());

  const run: LiveRun = { runId, events: [], subscribers: new Set(), abort: new AbortController(), done: false };
  live.set(runId, run);
  void execute(db, run, opts);
  return runId;
}

export function cancelRun(db: DB, runId: string): boolean {
  const run = live.get(runId);
  if (!run || run.done) return false;
  run.abort.abort(); // bridge sees the socket close and SIGTERMs the claude child
  db.prepare("UPDATE claude_runs SET status = 'cancelled', finished_at = ? WHERE run_id = ? AND status IN ('queued','running')").run(
    nowIso(),
    runId,
  );
  return true;
}

function push(run: LiveRun, line: string): void {
  run.events.push(line);
  appendFileSync(transcriptFile(run.runId), line + "\n");
  for (const sub of run.subscribers) sub(line);
}

function finish(run: LiveRun): void {
  run.done = true;
  for (const sub of run.subscribers) sub(null);
  run.subscribers.clear();
  // Keep the buffer around briefly for stragglers, then drop the live entry
  // (the transcript file remains the durable copy).
  setTimeout(() => live.delete(run.runId), 60_000).unref();
}

async function execute(
  db: DB,
  run: LiveRun,
  opts: { prompt: string; permissionMode: string },
): Promise<void> {
  const timeout = setTimeout(() => run.abort.abort(new Error("run timeout")), CLAUDE_TIMEOUT_MS);
  timeout.unref();
  db.prepare("UPDATE claude_runs SET status = 'running', started_at = ? WHERE run_id = ?").run(nowIso(), run.runId);

  let sawResult = false;
  let bridgeExit: number | null = null;
  try {
    const res = await fetch(`${CLAUDE_BRIDGE_URL}/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(CLAUDE_BRIDGE_TOKEN ? { authorization: `Bearer ${CLAUDE_BRIDGE_TOKEN}` } : {}),
      },
      body: JSON.stringify({ prompt: opts.prompt, permissionMode: opts.permissionMode }),
      signal: run.abort.signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(`bridge ${res.status}: ${text.slice(0, 300) || "no body"}`);
    }

    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body as any as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        push(run, line);

        let obj: any;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        if (obj.type === "result") {
          sawResult = true;
          db.prepare(
            `UPDATE claude_runs SET status = ?, result_text = ?, error = ?, num_turns = ?, duration_ms = ?,
             total_cost_usd = ?, input_tokens = ?, output_tokens = ?, finished_at = ? WHERE run_id = ?`,
          ).run(
            obj.is_error ? "error" : "done",
            typeof obj.result === "string" ? obj.result : JSON.stringify(obj.result ?? ""),
            obj.is_error ? String(obj.result ?? obj.subtype ?? "error") : null,
            obj.num_turns ?? null,
            obj.duration_ms ?? null,
            obj.total_cost_usd ?? null,
            obj.usage?.input_tokens ?? null,
            obj.usage?.output_tokens ?? null,
            nowIso(),
            run.runId,
          );
        } else if (obj.type === "bridge_done") {
          bridgeExit = obj.exit_code ?? null;
        }
      }
    }

    if (!sawResult) {
      throw new Error(
        bridgeExit !== null && bridgeExit !== 0
          ? `claude exited ${bridgeExit} without a result`
          : "stream ended without a result event",
      );
    }
  } catch (e: any) {
    const cancelled = run.abort.signal.aborted && !(run.abort.signal.reason instanceof Error);
    const msg = run.abort.signal.aborted
      ? cancelled
        ? "cancelled"
        : String(run.abort.signal.reason?.message ?? "timed out")
      : String(e?.message ?? e);
    if (!sawResult) {
      db.prepare(
        "UPDATE claude_runs SET status = ?, error = ?, finished_at = ? WHERE run_id = ? AND status IN ('queued','running')",
      ).run(cancelled ? "cancelled" : "error", cancelled ? null : msg, nowIso(), run.runId);
    }
    push(run, JSON.stringify({ type: "bridge_error", error: msg }));
  } finally {
    clearTimeout(timeout);
    finish(run);
  }
}
