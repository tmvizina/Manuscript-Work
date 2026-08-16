/**
 * Renderer-facing data contracts for the first native transport slice.
 *
 * These deliberately mirror the data-only shape exposed by the desktop
 * preload bridge. The HTTP adapter translates the legacy server's snake_case
 * payloads into these types so React does not need to know which runtime it is
 * running in.
 */

export type TransportMode = "http" | "electron";

export type SearchScope = "all" | "chapters" | "world" | "reviews";
export type SearchResultScope = Exclude<SearchScope, "all">;

export interface ProjectSummary {
  projectId: string;
  name: string;
  rootPath: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type ProjectProfileId = "fantasy" | "nonfiction";
export type ProjectPresetId = "fly-night-fishing";
export interface ProjectProfileConfig {
  schemaVersion: 1;
  profile: ProjectProfileId;
  preset?: ProjectPresetId;
  editorialMode: "narrative" | "practical-narrative";
  claimsPolicy: "canon" | "experience-led";
  memoryRoot: "world";
  memoryLabel: "World" | "Knowledge Base";
}
export interface ProjectImportInput { profile: ProjectProfileId; preset?: ProjectPresetId }

export interface ProjectDetail extends ProjectSummary {
  manuscriptRoot?: string;
  worldRoot?: string;
  description?: string;
  profile?: ProjectProfileConfig;
  profileSource?: "default" | "project";
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

export interface WorldSummary {
  documentId: string;
  relPath: string;
  title?: string;
  updatedAt?: string;
}

export interface WorldDocument extends WorldSummary {
  text: string;
  /** Present for the legacy HTTP route, which renders Markdown server-side. */
  html?: string;
  kind?: "md" | "json";
  bytes?: number;
}
export interface ReviewSummary { relPath: string; name: string; ext: string; kind: "review" | "decisions" | "rewrites" | "plan" | "findings" | "state"; date: string | null; scope: string | null; title: string | null; updatedAt: string; stats: Record<string, ProjectSettingValue> }
export interface ReviewDocument { relPath: string; kind: ReviewSummary["kind"]; updatedAt: string; bytes: number; text: string }

export interface SearchRequest {
  /** HTTP compatibility does not need a project ID; Electron does. */
  projectId?: string;
  query: string;
  scope?: SearchScope;
  limit?: number;
}

export interface SearchResult {
  resultId: string;
  scope: SearchResultScope;
  relPath: string;
  title: string;
  snippet: string;
  score?: number;
}

export type ProjectSettingKey = "preferredProvider" | "defaultModel" | "permissionMode" | "runVariant";
export type ProjectSettingValue = string | number | boolean | null | ProjectSettingValue[] | { [key: string]: ProjectSettingValue };
export interface SettingRecord {
  projectId: string;
  key: ProjectSettingKey;
  value: ProjectSettingValue;
  updatedAt: string;
}

export type ExecutionProvider = "claude" | "codex";
export type ProviderStatus = "unknown" | "checking" | "ready" | "not_installed" | "auth_required" | "unavailable" | "error";
export interface ProviderSummary { provider: ExecutionProvider; status: ProviderStatus; version?: string; executablePath?: string; account?: string; message?: string; checkedAt?: string }
export type InstallSource = "embedded" | "executable" | "local" | "online";
export type InstallStatus = "installed" | "already_installed" | "not_installed" | "manual_action_required" | "opened_external" | "cancelled" | "pending_approval" | "failed";
export interface InstallResult { provider: ExecutionProvider; status: InstallStatus; ok: boolean; installed: boolean; version?: string; executablePath?: string; message?: string }
export type AuthStatus = "authenticated" | "auth_required" | "expired" | "unsupported" | "failed";
export interface AuthResult { provider: ExecutionProvider; status: AuthStatus; ok: boolean; authenticated: boolean; account?: string; expiresAt?: string; message?: string }
export interface AuthCancelResult { provider: ExecutionProvider; cancelled: boolean }
export type RunVariant = "base" | "rag";
export type PermissionMode = "default" | "acceptEdits" | "plan";
export type RunStatus = "queued" | "starting" | "running" | "completed" | "failed" | "cancelled";
export interface RunRequest { provider: ExecutionProvider; prompt: string; projectId?: string | null; skillId?: string | null; variant?: RunVariant; permissionMode?: PermissionMode; model?: string }
export interface RunAccepted { runId: string; provider: ExecutionProvider; status: "queued" | "starting" | "running" }
export interface RunRecord { runId: string; projectId?: string | null; provider: ExecutionProvider; model?: string; skillId?: string | null; variant: RunVariant; status: RunStatus; prompt: string; resultText?: string; error?: string; usage?: { inputTokens?: number; outputTokens?: number; durationMs?: number; totalCostUsd?: number }; createdAt: string; startedAt?: string; finishedAt?: string }
export interface RunEvent { runId: string; provider: ExecutionProvider; sequence: number; type: string; text?: string; name?: string; output?: string; status?: string; result?: string; error?: { message: string }; data?: ProjectSettingValue }
export interface RunSubscription { subscriptionId: string; runId: string; replayCursor: number; replayTruncated: boolean }
export interface RunListRequest { projectId?: string; skillId?: string; limit?: number }

export interface ChapterReadOptions {
  fresh?: boolean;
}

export interface ProjectTransport {
  list(): Promise<ProjectSummary[]>;
  get(projectId: string): Promise<ProjectDetail | null>;
  open(projectId: string): Promise<ProjectSummary>;
  import(input: ProjectImportInput): Promise<ProjectDetail | null>;
}

export interface ChapterTransport {
  list(projectId?: string): Promise<ChapterSummary[]>;
  get(projectId: string | undefined, chapterId: string, options?: ChapterReadOptions): Promise<ChapterDocument>;
  refresh(projectId?: string): Promise<ChapterSummary[]>;
}

export interface WorldTransport {
  list(projectId?: string): Promise<WorldSummary[]>;
  get(projectId: string | undefined, relPath: string): Promise<WorldDocument>;
}

export interface ContentTransport {
  listChapters(projectId?: string): Promise<ChapterSummary[]>;
  getChapter(projectId: string | undefined, chapterId: string, options?: ChapterReadOptions): Promise<ChapterDocument>;
  listWorld(projectId?: string): Promise<WorldSummary[]>;
  getWorld(projectId: string | undefined, relPath: string): Promise<WorldDocument>;
  listReviews(projectId?: string): Promise<ReviewSummary[]>;
  getReview(projectId: string | undefined, relPath: string): Promise<ReviewDocument>;
}

export interface SearchTransport {
  query(request: SearchRequest): Promise<SearchResult[]>;
}

export interface SettingsTransport {
  get(projectId: string, key: ProjectSettingKey): Promise<SettingRecord | null>;
  set(projectId: string, key: ProjectSettingKey, value: ProjectSettingValue): Promise<SettingRecord>;
}

export interface RunsTransport {
  start(request: RunRequest): Promise<RunAccepted>;
  list(request?: RunListRequest): Promise<RunRecord[]>;
  get(runId: string): Promise<RunRecord>;
  cancel(runId: string): Promise<{ runId: string; cancelled: boolean }>;
  subscribe(runId: string, listener: (event: RunEvent) => void, options?: { afterSequence?: number }, onError?: (error: { message: string }) => void): Promise<RunSubscription>;
  unsubscribe(subscriptionId: string): Promise<{ subscriptionId: string; unsubscribed: boolean }>;
}

export interface ProvidersTransport {
  list(): Promise<ProviderSummary[]>;
  status(provider?: ExecutionProvider): Promise<ProviderSummary[]>;
  install(provider: ExecutionProvider, source: InstallSource): Promise<InstallResult>;
  auth(provider: ExecutionProvider): Promise<AuthResult>;
  cancelAuth(provider: ExecutionProvider): Promise<AuthCancelResult>;
}

export interface BookWriterTransport {
  readonly mode: TransportMode;
  readonly projects: ProjectTransport;
  readonly content: ContentTransport;
  readonly search: SearchTransport;
  readonly settings: SettingsTransport;
  readonly runs: RunsTransport;
  readonly providers: ProvidersTransport;

  /** Convenience aliases for consumers that do not need the content grouping. */
  readonly chapters: ChapterTransport;
  readonly world: WorldTransport;
}

export type ReadOnlyTransport = BookWriterTransport;
