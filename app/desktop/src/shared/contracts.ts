/** Renderer-facing IPC contracts. Keep these data-only and JSON-serializable. */

export const EXECUTION_PROVIDERS = ["claude", "codex"] as const;
export type ExecutionProvider = (typeof EXECUTION_PROVIDERS)[number];

export type ProviderStatus =
  | "unknown"
  | "checking"
  | "ready"
  | "not_installed"
  | "auth_required"
  | "unavailable"
  | "error";

export type RunVariant = "base" | "rag";
export type PermissionMode = "default" | "acceptEdits" | "plan";
export type RunStatus = "queued" | "starting" | "running" | "completed" | "failed" | "cancelled";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ProviderSummary {
  provider: ExecutionProvider;
  status: ProviderStatus;
  version?: string;
  executablePath?: string;
  account?: string;
  message?: string;
  checkedAt?: string;
}

export type InstallStatus = "installed" | "already_installed" | "not_installed" | "failed";

export interface InstallResult {
  provider: ExecutionProvider;
  status: InstallStatus;
  ok: boolean;
  installed: boolean;
  version?: string;
  executablePath?: string;
  message?: string;
}

export type AuthStatus = "authenticated" | "auth_required" | "expired" | "unsupported" | "failed";

export interface AuthResult {
  provider: ExecutionProvider;
  status: AuthStatus;
  ok: boolean;
  authenticated: boolean;
  account?: string;
  expiresAt?: string;
  message?: string;
}

export interface ProjectSummary {
  projectId: string;
  name: string;
  rootPath: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectDetail extends ProjectSummary {
  manuscriptRoot?: string;
  worldRoot?: string;
  description?: string;
}

export interface ChapterSummary {
  chapterId: string;
  book: string;
  relPath: string;
  number: number;
  title: string;
  wordCount: number;
  active: boolean;
  updatedAt?: string;
}

export interface ChapterDocument extends ChapterSummary {
  text: string;
  sha256?: string;
}

export interface WorldDocument {
  documentId: string;
  relPath: string;
  title?: string;
  text: string;
  updatedAt?: string;
}

export interface RunRequest {
  provider: ExecutionProvider;
  prompt: string;
  projectId?: string | null;
  skillId?: string | null;
  variant?: RunVariant;
  permissionMode?: PermissionMode;
  model?: string;
}

export interface RunAccepted {
  runId: string;
  provider: ExecutionProvider;
  status: Extract<RunStatus, "queued" | "starting" | "running">;
}

export interface RunUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  totalTokens?: number;
  durationMs?: number;
  totalCostUsd?: number;
}

export interface RunRecord {
  runId: string;
  projectId?: string | null;
  provider: ExecutionProvider;
  model?: string;
  skillId?: string | null;
  variant: RunVariant;
  status: RunStatus;
  prompt: string;
  resultText?: string;
  error?: string;
  usage?: RunUsage;
  transcriptPath?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface RunCancelResult {
  runId: string;
  cancelled: boolean;
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

export const RUN_EVENT_TYPES: readonly RunEventType[] = [
  "run_started",
  "turn_started",
  "text_delta",
  "reasoning_delta",
  "tool_call",
  "tool_result",
  "run_completed",
  "run_failed",
  "stream_ended",
  "provider_status",
  "unknown",
  "malformed",
];

/** Renderer events intentionally omit provider-private raw payloads. */
export interface RunEvent {
  runId: string;
  provider: ExecutionProvider;
  sequence: number;
  type: RunEventType;
  text?: string;
  role?: "assistant" | "user" | "system";
  itemId?: string;
  toolCallId?: string;
  name?: string;
  input?: JsonValue;
  output?: string;
  status?: string;
  result?: string;
  error?: StructuredError;
  exitCode?: number | null;
  data?: JsonValue;
}

export type SearchScope = "all" | "chapters" | "world" | "reviews";

export interface SearchRequest {
  projectId: string;
  query: string;
  scope?: SearchScope;
  limit?: number;
}

export interface SearchResult {
  resultId: string;
  scope: Exclude<SearchScope, "all">;
  relPath: string;
  title: string;
  snippet: string;
  score?: number;
}

export type SettingValue = JsonValue;

export interface SettingRecord {
  projectId: string;
  key: string;
  value: SettingValue;
  updatedAt: string;
}

export interface ProviderApi {
  list(): Promise<ProviderSummary[]>;
  status(provider?: ExecutionProvider): Promise<ProviderSummary[]>;
  install(provider: ExecutionProvider): Promise<InstallResult>;
  auth(provider: ExecutionProvider): Promise<AuthResult>;
}

export interface ProjectApi {
  list(): Promise<ProjectSummary[]>;
  get(projectId: string): Promise<ProjectDetail | null>;
  open(projectId: string): Promise<ProjectSummary>;
}

export interface ContentApi {
  listChapters(projectId: string): Promise<ChapterSummary[]>;
  getChapter(projectId: string, chapterId: string): Promise<ChapterDocument>;
  listWorld(projectId: string): Promise<WorldDocument[]>;
  getWorld(projectId: string, relPath: string): Promise<WorldDocument>;
}

export type RunEventListener = (event: RunEvent) => void;
export type Unsubscribe = () => void;

export interface RunApi {
  start(request: RunRequest): Promise<RunAccepted>;
  get(runId: string): Promise<RunRecord>;
  cancel(runId: string): Promise<RunCancelResult>;
  subscribe(runId: string, listener: RunEventListener, onError?: (error: StructuredError) => void): Unsubscribe;
}

export interface SearchApi {
  query(request: SearchRequest): Promise<SearchResult[]>;
}

export interface SettingsApi {
  get(projectId: string, key: string): Promise<SettingRecord | null>;
  set(projectId: string, key: string, value: SettingValue): Promise<SettingRecord>;
}

export interface BookWriterApi {
  providers: ProviderApi;
  projects: ProjectApi;
  content: ContentApi;
  runs: RunApi;
  search: SearchApi;
  settings: SettingsApi;
}

export const BOOK_WRITER_WINDOW_KEY = "bookWriter" as const;

export const IPC_CHANNELS = {
  providers: {
    list: "book-writer/providers/list",
    status: "book-writer/providers/status",
    install: "book-writer/providers/install",
    auth: "book-writer/providers/auth",
  },
  projects: {
    list: "book-writer/projects/list",
    get: "book-writer/projects/get",
    open: "book-writer/projects/open",
  },
  content: {
    listChapters: "book-writer/content/list-chapters",
    getChapter: "book-writer/content/get-chapter",
    listWorld: "book-writer/content/list-world",
    getWorld: "book-writer/content/get-world",
  },
  runs: {
    start: "book-writer/runs/start",
    get: "book-writer/runs/get",
    cancel: "book-writer/runs/cancel",
    event: "book-writer/runs/event",
  },
  search: { query: "book-writer/search/query" },
  settings: {
    get: "book-writer/settings/get",
    set: "book-writer/settings/set",
  },
} as const;

export interface StructuredError {
  name: "BookWriterError";
  code: string;
  message: string;
  operation?: string;
  retryable?: boolean;
  details?: JsonValue;
}

export type IpcResponse<T> = { ok: true; value: T } | { ok: false; error: StructuredError };
