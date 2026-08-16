/** Provider-agnostic contracts shared by the desktop runner and adapters. */

export const EXECUTION_PROVIDERS = ["claude", "codex"] as const;
export type ExecutionProvider = (typeof EXECUTION_PROVIDERS)[number];

/** A provider can be installed but still require login, or be temporarily unavailable. */
export type ProviderStatus =
  | "unknown"
  | "checking"
  | "ready"
  | "not_installed"
  | "auth_required"
  | "unavailable"
  | "error";

export interface ProviderStatusInfo {
  provider: ExecutionProvider;
  status: ProviderStatus;
  version?: string;
  executablePath?: string;
  account?: string;
  message?: string;
  checkedAt?: string;
}

export type RunVariant = "base" | "rag";
export type PermissionMode = "default" | "acceptEdits" | "plan";

export interface RunRequest {
  provider: ExecutionProvider;
  prompt: string;
  skillId?: string | null;
  variant?: RunVariant;
  permissionMode?: PermissionMode;
  cwd?: string;
  extraDirs?: string[];
  model?: string;
  metadata?: Record<string, string>;
}

export type RunStatus = "queued" | "starting" | "running" | "completed" | "failed" | "cancelled";
export type QueueStatus = "idle" | "queued" | "running" | "paused" | "draining";

export interface QueueSnapshot {
  status: QueueStatus;
  queued: number;
  active: number;
  maxConcurrent: number;
  updatedAt?: string;
}

export interface ExecutionError {
  code: string;
  message: string;
  provider?: ExecutionProvider;
  line?: number;
  retryable?: boolean;
  cause?: unknown;
}

export interface RunUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  totalTokens?: number;
  durationMs?: number;
  durationApiMs?: number;
  totalCostUsd?: number;
  numTurns?: number;
}

export interface RunResult {
  runId: string;
  provider: ExecutionProvider;
  status: Exclude<RunStatus, "queued" | "starting" | "running">;
  resultText?: string;
  error?: ExecutionError;
  usage?: RunUsage;
  exitCode?: number | null;
  startedAt?: string;
  finishedAt?: string;
}

export type RunEventType =
  | "run_started"
  | "turn_started"
  | "text_delta"
  | "reasoning_delta"
  | "tool_call"
  | "tool_result"
  | "run_completed"
  | "run_failed"
  | "stream_ended"
  | "provider_status"
  | "unknown"
  | "malformed";

export interface RunEventBase {
  provider: ExecutionProvider;
  sequence: number;
  line?: number;
  raw?: unknown;
  timestamp?: string;
}

export interface RunStartedEvent extends RunEventBase {
  type: "run_started";
  runId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface TurnStartedEvent extends RunEventBase {
  type: "turn_started";
  turnId?: string;
}

export interface TextDeltaEvent extends RunEventBase {
  type: "text_delta";
  role: "assistant" | "user" | "system";
  text: string;
  itemId?: string;
  delta?: boolean;
  final?: boolean;
}

export interface ReasoningDeltaEvent extends RunEventBase {
  type: "reasoning_delta";
  text: string;
  itemId?: string;
  delta?: boolean;
  final?: boolean;
}

export interface ToolCallEvent extends RunEventBase {
  type: "tool_call";
  toolCallId?: string;
  name?: string;
  input?: unknown;
  command?: string;
  status?: string;
}

export interface ToolResultEvent extends RunEventBase {
  type: "tool_result";
  toolCallId?: string;
  output?: string;
  exitCode?: number | null;
  status?: string;
}

export interface RunCompletedEvent extends RunEventBase {
  type: "run_completed";
  result?: string;
  usage?: RunUsage;
  exitCode?: number | null;
  numTurns?: number;
}

export interface RunFailedEvent extends RunEventBase {
  type: "run_failed";
  error: ExecutionError;
  result?: string;
  exitCode?: number | null;
}

export interface StreamEndedEvent extends RunEventBase {
  type: "stream_ended";
  exitCode?: number | null;
}

export interface ProviderStatusEvent extends RunEventBase {
  type: "provider_status";
  status: ProviderStatus;
  message?: string;
}

export interface UnknownEvent extends RunEventBase {
  type: "unknown";
  sourceType?: string;
  data: unknown;
}

export interface MalformedEvent extends RunEventBase {
  type: "malformed";
  rawLine: string;
  error: ExecutionError;
}

export type RunEvent =
  | RunStartedEvent
  | TurnStartedEvent
  | TextDeltaEvent
  | ReasoningDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | RunCompletedEvent
  | RunFailedEvent
  | StreamEndedEvent
  | ProviderStatusEvent
  | UnknownEvent
  | MalformedEvent;

export type RunEventListener = (event: RunEvent) => void;

export interface RunHandle {
  runId: string;
  provider: ExecutionProvider;
  request: RunRequest;
  status: RunStatus;
  events: AsyncIterable<RunEvent>;
  cancel(reason?: string): Promise<boolean> | boolean;
  wait(): Promise<RunResult>;
  subscribe(listener: RunEventListener): () => void;
}

export type InstallStatus = "installed" | "already_installed" | "not_installed" | "failed";

export interface ProviderInstallResult {
  provider: ExecutionProvider;
  status: InstallStatus;
  ok: boolean;
  installed: boolean;
  version?: string;
  executablePath?: string;
  message?: string;
  error?: ExecutionError;
}

export type AuthStatus = "authenticated" | "auth_required" | "expired" | "unsupported" | "failed";

export interface ProviderAuthResult {
  provider: ExecutionProvider;
  status: AuthStatus;
  ok: boolean;
  authenticated: boolean;
  account?: string;
  expiresAt?: string;
  message?: string;
  error?: ExecutionError;
}

/** Short aliases keep adapter code readable while retaining descriptive names. */
export type InstallResult = ProviderInstallResult;
export type AuthResult = ProviderAuthResult;

