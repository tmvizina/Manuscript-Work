import type {
  ExecutionProvider,
  PermissionMode,
  RunStatus,
  RunUsage,
  RunVariant,
} from "../execution/contracts.js";
import type { DB } from "./db.js";
import { newId, nowIso } from "./db.js";

interface AgentRunRow {
  run_id: string;
  project_id: string | null;
  provider: ExecutionProvider;
  model: string | null;
  skill_id: string | null;
  variant: RunVariant;
  permission_mode: PermissionMode;
  status: RunStatus;
  prompt: string;
  result_text: string;
  error: string | null;
  transcript_path: string | null;
  num_turns: number | null;
  duration_ms: number | null;
  total_cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}
export interface AgentRunRecord {
  runId: string;
  projectId: string | null;
  provider: ExecutionProvider;
  model: string | null;
  skillId: string | null;
  variant: RunVariant;
  permissionMode: PermissionMode;
  status: RunStatus;
  prompt: string;
  resultText: string;
  error: string | null;
  transcriptPath: string | null;
  usage: RunUsage;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface CreateAgentRunInput {
  runId?: string;
  projectId?: string | null;
  provider: ExecutionProvider;
  model?: string | null;
  skillId?: string | null;
  variant?: RunVariant;
  permissionMode?: PermissionMode;
  prompt: string;
  transcriptPath?: string | null;
}

export interface FinishAgentRunInput {
  status: Extract<RunStatus, "completed" | "failed" | "cancelled">;
  resultText?: string;
  error?: string | null;
  usage?: RunUsage;
}

const RUN_COLUMNS = `run_id, project_id, provider, model, skill_id, variant,
  permission_mode, status, prompt, result_text, error, transcript_path,
  num_turns, duration_ms, total_cost_usd, input_tokens, output_tokens,
  created_at, started_at, finished_at`;

function mapRun(row: AgentRunRow): AgentRunRecord {
  const usage: RunUsage = {};
  if (row.num_turns !== null) usage.numTurns = row.num_turns;
  if (row.duration_ms !== null) usage.durationMs = row.duration_ms;
  if (row.total_cost_usd !== null) usage.totalCostUsd = row.total_cost_usd;
  if (row.input_tokens !== null) usage.inputTokens = row.input_tokens;
  if (row.output_tokens !== null) usage.outputTokens = row.output_tokens;
  return {
    runId: row.run_id,
    projectId: row.project_id,
    provider: row.provider,
    model: row.model,
    skillId: row.skill_id,
    variant: row.variant,
    permissionMode: row.permission_mode,
    status: row.status,
    prompt: row.prompt,
    resultText: row.result_text,
    error: row.error,
    transcriptPath: row.transcript_path,
    usage,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function createAgentRun(db: DB, input: CreateAgentRunInput): AgentRunRecord {
  const runId = input.runId ?? newId("run");
  const createdAt = nowIso();
  db.prepare(
    `INSERT INTO agent_runs(
       run_id, project_id, provider, model, skill_id, variant, permission_mode,
       status, prompt, result_text, transcript_path, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, '', ?, ?)`,
  ).run(
    runId,
    input.projectId ?? null,
    input.provider,
    input.model ?? null,
    input.skillId ?? null,
    input.variant ?? "base",
    input.permissionMode ?? "default",
    input.prompt,
    input.transcriptPath ?? null,
    createdAt,
  );
  return getAgentRun(db, runId) as AgentRunRecord;
}

export function getAgentRun(db: DB, runId: string): AgentRunRecord | null {
  const row = db.prepare(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE run_id = ?`).get(runId) as
    | AgentRunRow
    | undefined;
  return row ? mapRun(row) : null;
}

export function markAgentRunStarted(db: DB, runId: string): boolean {
  return db.prepare(
    `UPDATE agent_runs SET status = 'running', started_at = ?
     WHERE run_id = ? AND status IN ('queued', 'starting')`,
  ).run(nowIso(), runId).changes === 1;
}

export function finishAgentRun(db: DB, runId: string, input: FinishAgentRunInput): boolean {
  const usage = input.usage ?? {};
  return db.prepare(
    `UPDATE agent_runs SET
       status = ?, result_text = ?, error = ?, num_turns = ?, duration_ms = ?,
       total_cost_usd = ?, input_tokens = ?, output_tokens = ?, finished_at = ?
     WHERE run_id = ? AND status IN ('queued', 'starting', 'running')`,
  ).run(
    input.status,
    input.resultText ?? "",
    input.error ?? null,
    usage.numTurns ?? null,
    usage.durationMs ?? null,
    usage.totalCostUsd ?? null,
    usage.inputTokens ?? null,
    usage.outputTokens ?? null,
    nowIso(),
    runId,
  ).changes === 1;
}

/** Mark runs whose process owner disappeared during shutdown or a crash. */
export function resolveOrphanedAgentRuns(db: DB, message = "interrupted by application restart"): number {
  return db.prepare(
    `UPDATE agent_runs SET status = 'failed', error = ?, finished_at = ?
     WHERE status IN ('queued', 'starting', 'running')`,
  ).run(message, nowIso()).changes;
}
