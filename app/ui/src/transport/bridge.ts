import type {
  ChapterDocument,
  ChapterSummary,
  ProjectDetail,
  ProjectImportInput,
  ProjectSummary,
  SearchRequest,
  SearchResult,
  ProjectSettingKey,
  ProjectSettingValue,
  SettingRecord,
  RunAccepted,
  RunEvent,
  RunListRequest,
  RunRecord,
  RunRequest,
  RunSubscription,
  ReviewDocument,
  ReviewSummary,
  ExecutionProvider,
  ProviderSummary,
  AuthResult,
  AuthCancelResult,
  InstallResult,
  InstallSource,
  WorldDocument,
  WorldSummary,
  ReviewIdReference,
  HelpDocument,
  HelpSectionSummary,
  RagProgressEvent,
  RagQueryResult,
  RagStatus,
} from "./types.js";

/**
 * The subset of the preload bridge used by Phase 3. This is structural on
 * purpose: the UI does not import Electron, the preload implementation, or
 * the desktop package at runtime.
 */
export interface BookWriterReadOnlyBridge {
  readonly providers: {
    list(): Promise<ProviderSummary[]>;
    status(provider?: ExecutionProvider): Promise<ProviderSummary[]>;
    install(provider: ExecutionProvider, source: InstallSource): Promise<InstallResult>;
    auth(provider: ExecutionProvider): Promise<AuthResult>;
    cancelAuth(provider: ExecutionProvider): Promise<AuthCancelResult>;
  };
  readonly projects: {
    list(): Promise<ProjectSummary[]>;
    get(projectId: string): Promise<ProjectDetail | null>;
    open(projectId: string): Promise<ProjectSummary>;
    import(input: ProjectImportInput): Promise<ProjectDetail | null>;
  };
  readonly content: {
    listChapters(projectId: string): Promise<ChapterSummary[]>;
    getChapter(projectId: string, chapterId: string): Promise<ChapterDocument>;
    listWorld(projectId: string): Promise<WorldSummary[]>;
    getWorld(projectId: string, relPath: string): Promise<WorldDocument>;
    listReviews(projectId: string): Promise<ReviewSummary[]>;
    reviewIdIndex(projectId: string): Promise<ReviewIdReference[]>;
    getReview(projectId: string, relPath: string): Promise<ReviewDocument>;
  };
  readonly search: {
    query(request: SearchRequest & { projectId: string }): Promise<SearchResult[]>;
  };
  readonly settings: {
    get(projectId: string, key: ProjectSettingKey): Promise<SettingRecord | null>;
    set(projectId: string, key: ProjectSettingKey, value: ProjectSettingValue): Promise<SettingRecord>;
  };
  readonly runs: {
    start(request: RunRequest): Promise<RunAccepted>;
    list(request?: RunListRequest): Promise<RunRecord[]>;
    get(runId: string): Promise<RunRecord>;
    cancel(runId: string): Promise<{ runId: string; cancelled: boolean }>;
    subscribe(runId: string, listener: (event: RunEvent) => void, options?: { afterSequence?: number }, onError?: (error: { message: string }) => void): Promise<RunSubscription>;
    unsubscribe(subscriptionId: string): Promise<{ subscriptionId: string; unsubscribed: boolean }>;
  };
  readonly help: {
    list(): Promise<HelpSectionSummary[]>;
    get(slug: string): Promise<HelpDocument>;
  };
  readonly rag: {
    status(projectId: string): Promise<RagStatus>;
    query(request: { projectId: string; query: string; k?: number }): Promise<{ results: RagQueryResult[] }>;
    reindex(request: { projectId: string }): Promise<{ projectId: string; status: string }>;
    cancel(projectId: string): Promise<{ projectId: string; status: string }>;
    subscribe(projectId: string, listener: (event: RagProgressEvent) => void): Promise<{ subscriptionId: string }>;
    unsubscribe(subscriptionId: string): Promise<{ subscriptionId: string; released: boolean }>;
  };
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function isFunction(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === "function";
}

function hasMethods(value: unknown, methods: readonly string[]): value is UnknownRecord {
  return isRecord(value) && methods.every((method) => isFunction(value[method]));
}

/**
 * Safe feature detection for the allow-listed preload object. In particular,
 * this never checks `process`, imports Electron, or assumes a browser global
 * exists (which keeps SSR and node-based tests harmless).
 */
export function isBookWriterReadOnlyBridge(value: unknown): value is BookWriterReadOnlyBridge {
  if (!isRecord(value)) return false;
  const projects = value.projects;
  const providers = value.providers;
  const content = value.content;
  const search = value.search;
  const settings = value.settings;
  const runs = value.runs;
  const rag = value.rag;
  const help = value.help;
  return (
    hasMethods(providers, ["list", "status", "install", "auth", "cancelAuth"]) &&
    hasMethods(projects, ["list", "get", "open", "import"]) &&
    hasMethods(content, ["listChapters", "getChapter", "listWorld", "getWorld", "listReviews", "getReview", "reviewIdIndex"]) &&
    hasMethods(search, ["query"]) &&
    hasMethods(settings, ["get", "set"]) &&
    hasMethods(runs, ["start", "list", "get", "cancel", "subscribe", "unsubscribe"]) &&
    hasMethods(rag, ["status", "query", "reindex", "cancel", "subscribe", "unsubscribe"]) &&
    hasMethods(help, ["list", "get"])
  );
}

/** Read `window.bookWriter` without relying on a global Window declaration. */
export function detectBookWriterReadOnlyBridge(root: unknown = globalThis): BookWriterReadOnlyBridge | undefined {
  if (isBookWriterReadOnlyBridge(root)) return root;
  if (!isRecord(root)) return undefined;
  const windowValue = root.window;
  if (!isRecord(windowValue)) return undefined;
  const bridge = windowValue.bookWriter;
  return isBookWriterReadOnlyBridge(bridge) ? bridge : undefined;
}
