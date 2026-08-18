import { invalidTransportResponse, toTransportError, TransportError, unsupportedTransport } from "./errors.js";
import type {
  BookWriterTransport,
  ChapterDocument,
  ChapterReadOptions,
  ChapterSummary,
  ContentTransport,
  ProjectDetail,
  ProjectProfileConfig,
  ProjectSummary,
  ProjectTransport,
  SearchRequest,
  SearchResult,
  SearchScope,
  SearchTransport,
  SettingsTransport,
  RunsTransport,
  ProvidersTransport,
  WorldDocument,
  WorldSummary,
  WorldTransport,
  HelpTransport,
  RagTransport,
} from "./types.js";

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface HttpTransportOptions {
  /** Injected in tests; defaults to the browser's fetch implementation. */
  fetch?: FetchLike;
  /** The compatibility project ID used by the pre-project HTTP server. */
  legacyProjectId?: string;
  legacyProjectName?: string;
}

interface ChapterRow {
  chapter_id?: unknown;
  chapterId?: unknown;
  book?: unknown;
  rel_path?: unknown;
  relPath?: unknown;
  number?: unknown;
  title?: unknown;
  word_count?: unknown;
  wordCount?: unknown;
  active?: unknown;
  file_mtime?: unknown;
  fileMtime?: unknown;
  synced_at?: unknown;
  updatedAt?: unknown;
  text?: unknown;
  sha256?: unknown;
}

interface WorldFileRow {
  rel_path?: unknown;
  relPath?: unknown;
  name?: unknown;
  title?: unknown;
  ext?: unknown;
}

interface WorldGroupRow {
  dir?: unknown;
  files?: unknown;
}

interface WorldTreePayload {
  exists?: unknown;
  groups?: unknown;
}

interface WorldDocumentPayload {
  rel_path?: unknown;
  relPath?: unknown;
  documentId?: unknown;
  title?: unknown;
  mtime?: unknown;
  updatedAt?: unknown;
  bytes?: unknown;
  kind?: unknown;
  text?: unknown;
  html?: unknown;
}

interface HealthPayload {
  projects?: unknown;
  manuscript_root?: unknown;
  repo_root?: unknown;
}

const DEFAULT_LEGACY_PROJECT_ID = "legacy";

function defaultFetch(): FetchLike {
  const fetchValue = globalThis.fetch;
  if (typeof fetchValue !== "function") {
    throw new TransportError("fetch is not available in this runtime", {
      kind: "http",
      code: "HTTP_UNAVAILABLE",
      operation: "http.init",
    });
  }
  return fetchValue.bind(globalThis);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback = true): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return fallback;
}

function arrayValue(value: unknown, operation: string): unknown[] {
  if (!Array.isArray(value)) throw invalidTransportResponse(operation, "Expected an array response");
  return value;
}

function firstValue(record: object, ...keys: string[]): unknown {
  const value = record as Record<string, unknown>;
  for (const key of keys) {
    if (value[key] !== undefined) return value[key];
  }
  return undefined;
}

function chapterSummary(row: unknown, operation: string): ChapterSummary {
  if (!isRecord(row)) throw invalidTransportResponse(operation, "Chapter response item is not an object");
  const value = row as ChapterRow;
  const chapterId = stringValue(firstValue(value, "chapter_id", "chapterId"));
  if (!chapterId) throw invalidTransportResponse(operation, "Chapter response is missing chapter_id");
  const relPath = stringValue(firstValue(value, "rel_path", "relPath"));
  const updatedAt = stringValue(firstValue(value, "updatedAt", "synced_at", "file_mtime", "fileMtime"));
  return {
    chapterId,
    book: stringValue(value.book),
    relPath,
    number: numberValue(value.number),
    title: stringValue(value.title),
    wordCount: numberValue(firstValue(value, "word_count", "wordCount")),
    active: booleanValue(value.active),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function chapterDocument(row: unknown, operation: string): ChapterDocument {
  if (!isRecord(row)) throw invalidTransportResponse(operation, "Chapter response is not an object");
  const summary = chapterSummary(row, operation);
  if (typeof row.text !== "string") throw invalidTransportResponse(operation, "Chapter response is missing text");
  const sha256 = stringValue(row.sha256);
  return { ...summary, text: row.text, ...(sha256 ? { sha256 } : {}) };
}

function projectSummary(row: unknown, operation: string): ProjectSummary {
  if (!isRecord(row)) throw invalidTransportResponse(operation, "Project response item is not an object");
  const projectId = stringValue(firstValue(row, "projectId", "project_id"));
  if (!projectId) throw invalidTransportResponse(operation, "Project response is missing projectId");
  const createdAt = stringValue(firstValue(row, "createdAt", "created_at"));
  const updatedAt = stringValue(firstValue(row, "updatedAt", "updated_at"));
  return {
    projectId,
    name: stringValue(row.name, projectId),
    rootPath: stringValue(firstValue(row, "rootPath", "root_path", "manuscriptRoot", "manuscript_root")),
    active: booleanValue(row.active),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function projectDetail(row: unknown, operation: string): ProjectDetail {
  if (!isRecord(row)) throw invalidTransportResponse(operation, "Project response is not an object");
  const summary = projectSummary(row, operation);
  const manuscriptRoot = stringValue(firstValue(row, "manuscriptRoot", "manuscript_root"));
  const worldRoot = stringValue(firstValue(row, "worldRoot", "world_root"));
  const description = stringValue(row.description);
  const profile = projectProfile(firstValue(row, "profile"));
  const profileSource = row.profileSource === "default" || row.profileSource === "project" ? row.profileSource : undefined;
  return {
    ...summary,
    ...(manuscriptRoot ? { manuscriptRoot } : {}),
    ...(worldRoot ? { worldRoot } : {}),
    ...(description ? { description } : {}),
    ...(profile ? { profile } : {}),
    ...(profileSource ? { profileSource } : {}),
  };
}

function projectProfile(value: unknown): ProjectProfileConfig | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.memoryRoot !== "world") return undefined;
  if (value.profile === "fantasy" && value.preset === undefined && value.editorialMode === "narrative" && value.claimsPolicy === "canon" && value.memoryLabel === "World") return value as unknown as ProjectProfileConfig;
  if (value.profile === "nonfiction" && value.preset === "fly-night-fishing" && value.editorialMode === "practical-narrative" && value.claimsPolicy === "experience-led" && value.memoryLabel === "Knowledge Base") return value as unknown as ProjectProfileConfig;
  return undefined;
}

function worldSummary(row: unknown, operation: string): WorldSummary {
  if (!isRecord(row)) throw invalidTransportResponse(operation, "World response item is not an object");
  const relPath = stringValue(firstValue(row, "relPath", "rel_path"));
  if (!relPath) throw invalidTransportResponse(operation, "World response is missing relPath");
  const documentId = stringValue(row.documentId, `world:${relPath}`);
  const title = stringValue(firstValue(row, "title", "name"));
  const updatedAt = stringValue(firstValue(row, "updatedAt", "mtime"));
  return {
    documentId,
    relPath,
    ...(title ? { title } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function worldDocument(row: unknown, operation: string): WorldDocument {
  if (!isRecord(row)) throw invalidTransportResponse(operation, "World response is not an object");
  const summary = worldSummary(row, operation);
  if (typeof row.text !== "string" && typeof row.html !== "string") {
    throw invalidTransportResponse(operation, "World response is missing text or html");
  }
  const text = typeof row.text === "string" ? row.text : "";
  const html = typeof row.html === "string" ? row.html : undefined;
  const kind = row.kind === "md" || row.kind === "json" ? row.kind : undefined;
  const bytes = typeof row.bytes === "number" && Number.isFinite(row.bytes) ? row.bytes : undefined;
  return {
    ...summary,
    text,
    ...(html === undefined ? {} : { html }),
    ...(kind === undefined ? {} : { kind }),
    ...(bytes === undefined ? {} : { bytes }),
  };
}

async function requestJson<T>(fetchImpl: FetchLike, path: string, init: RequestInit | undefined, operation: string): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(path, {
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      ...init,
    });
  } catch (error) {
    throw toTransportError(error, operation, "http");
  }

  let data: unknown = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    const message = isRecord(data) && typeof data.error === "string" ? data.error : `${response.status} ${response.statusText}`;
    throw new TransportError(message, { kind: "http", code: "HTTP_ERROR", operation, status: response.status });
  }
  return data as T;
}

function createProjects(fetchImpl: FetchLike, options: HttpTransportOptions): ProjectTransport {
  const legacyId = options.legacyProjectId ?? DEFAULT_LEGACY_PROJECT_ID;
  return {
    async list() {
      const operation = "projects.list";
      const health = await requestJson<HealthPayload>(fetchImpl, "/api/health", undefined, operation);
      if (Array.isArray(health.projects)) return health.projects.map((row) => projectSummary(row, operation));
      const rootPath = stringValue(firstValue(health as Record<string, unknown>, "manuscript_root", "repo_root"));
      return [{ projectId: legacyId, name: options.legacyProjectName ?? "Book Writer", rootPath, active: true }];
    },
    async get(projectId) {
      if (projectId !== legacyId) return null;
      const payload = await requestJson<unknown>(fetchImpl, "/api/project", undefined, "projects.get");
      return projectDetail(payload, "projects.get");
    },
    async open(projectId) {
      const project = await this.get(projectId);
      if (!project) throw new TransportError("Project was not found", { kind: "http", code: "NOT_FOUND", operation: "projects.open", status: 404 });
      return project;
    },
    async import() {
      throw unsupportedTransport("projects.import");
    },
  };
}

function createChapters(fetchImpl: FetchLike): ChapterTransportImplementation {
  const list = async (_projectId?: string) => {
    const operation = "content.listChapters";
    const payload = await requestJson<{ chapters?: unknown } | unknown[]>(fetchImpl, "/api/chapters", undefined, operation);
    const rows = Array.isArray(payload) ? payload : payload && isRecord(payload) ? payload.chapters : undefined;
    return arrayValue(rows, operation).map((row) => chapterSummary(row, operation));
  };
  return {
    list,
    async get(_projectId, chapterId, readOptions) {
      const operation = "content.getChapter";
      if (!chapterId) throw new TransportError("chapterId must not be empty", { kind: "http", code: "INVALID_ARGUMENT", operation });
      const fresh = readOptions?.fresh ? "?fresh=1" : "";
      const payload = await requestJson<unknown>(fetchImpl, `/api/chapters/${encodeURIComponent(chapterId)}${fresh}`, undefined, operation);
      return chapterDocument(payload, operation);
    },
    async refresh(projectId) {
      await requestJson(fetchImpl, "/api/chapters/sync", { method: "POST" }, "content.refreshChapters");
      return list(projectId);
    },
  };
}

interface ChapterTransportImplementation {
  list(projectId?: string): Promise<ChapterSummary[]>;
  get(projectId: string | undefined, chapterId: string, options?: ChapterReadOptions): Promise<ChapterDocument>;
  refresh(projectId?: string): Promise<ChapterSummary[]>;
}

function createWorld(fetchImpl: FetchLike): WorldTransportImplementation {
  return {
    async list(_projectId) {
      const operation = "content.listWorld";
      const payload = await requestJson<WorldTreePayload | unknown[]>(fetchImpl, "/api/world", undefined, operation);
      if (Array.isArray(payload)) return payload.map((row) => worldSummary(row, operation));
      if (!isRecord(payload)) throw invalidTransportResponse(operation, "World response is not an object");
      const groups = arrayValue(payload.groups, operation);
      const entries: WorldSummary[] = [];
      for (const group of groups) {
        if (!isRecord(group)) throw invalidTransportResponse(operation, "World group is not an object");
        const files = arrayValue((group as WorldGroupRow).files, operation);
        entries.push(...files.map((file) => worldSummary(file, operation)));
      }
      return entries;
    },
    async get(_projectId, relPath) {
      const operation = "content.getWorld";
      if (!relPath) throw new TransportError("relPath must not be empty", { kind: "http", code: "INVALID_ARGUMENT", operation });
      const payload = await requestJson<WorldDocumentPayload>(fetchImpl, `/api/world/file?path=${encodeURIComponent(relPath)}`, undefined, operation);
      return worldDocument(payload, operation);
    },
  };
}

interface WorldTransportImplementation {
  list(projectId?: string): Promise<WorldSummary[]>;
  get(projectId: string | undefined, relPath: string): Promise<WorldDocument>;
}

function createSearch(fetchImpl: FetchLike): SearchTransport {
  return {
    async query(_request: SearchRequest) {
      throw unsupportedTransport(
        "search.query",
        "Literal project search is not available through the compatibility server; use the existing RAG page for semantic search.",
      );
    },
  };
}

function createSettings(): SettingsTransport {
  return {
    async get() { throw unsupportedTransport("settings.get", "Project settings remain desktop-only during the Electron migration."); },
    async set() { throw unsupportedTransport("settings.set", "Project settings remain desktop-only during the Electron migration."); },
  };
}

function createRuns(): RunsTransport {
  const unavailable = (operation: string) => unsupportedTransport(operation, "Native run transport is desktop-only; the compatibility UI keeps its legacy Claude bridge routes.");
  return {
    async start() { throw unavailable("runs.start"); },
    async list() { throw unavailable("runs.list"); },
    async get() { throw unavailable("runs.get"); },
    async cancel() { throw unavailable("runs.cancel"); },
    async subscribe() { throw unavailable("runs.subscribe"); },
    async unsubscribe() { throw unavailable("runs.unsubscribe"); },
  };
}

function createProviders(): ProvidersTransport {
  return {
    async list() { throw unsupportedTransport("providers.list", "Provider discovery is available only in the native desktop app."); },
    async status() { throw unsupportedTransport("providers.status", "Provider discovery is available only in the native desktop app."); },
    async install() { throw unsupportedTransport("providers.install", "Provider installation recovery is available only in the native desktop app."); },
    async auth() { throw unsupportedTransport("providers.auth", "Provider authentication is available only in the native desktop app."); },
    async cancelAuth() { throw unsupportedTransport("providers.authCancel", "Provider authentication is available only in the native desktop app."); },
  };
}

/** Build the browser/development transport over the current Fastify routes. */
export function createHttpTransport(options: HttpTransportOptions = {}): BookWriterTransport {
  const fetchImpl = options.fetch ?? defaultFetch();
  const projects = createProjects(fetchImpl, options);
  const providers = createProviders();
  const chapters = createChapters(fetchImpl);
  const world = createWorld(fetchImpl);
  const search = createSearch(fetchImpl);
  const settings = createSettings();
  const runs = createRuns();
  const content: ContentTransport = {
    listChapters: chapters.list,
    getChapter: chapters.get,
    listWorld: world.list,
    getWorld: world.get,
    async listReviews() { throw unsupportedTransport("content.listReviews", "The compatibility Reviews page keeps its existing server routes."); },
    async getReview() { throw unsupportedTransport("content.getReview", "The compatibility Reviews page keeps its existing server routes."); },
  };
  // Semantic search over the compatibility server keeps its own existing page
  // and routes. Exposing it here would let a packaged renderer fall back to a
  // localhost service, which this migration exists to remove.
  const rag: RagTransport = {
    async status() { throw unsupportedTransport("rag.status", "Semantic search is desktop-only; the browser app keeps its existing RAG page."); },
    async query() { throw unsupportedTransport("rag.query", "Semantic search is desktop-only; the browser app keeps its existing RAG page."); },
    async reindex() { throw unsupportedTransport("rag.reindex", "Semantic search is desktop-only; the browser app keeps its existing RAG page."); },
    async cancel() { throw unsupportedTransport("rag.cancel", "Semantic search is desktop-only; the browser app keeps its existing RAG page."); },
    async subscribe() { throw unsupportedTransport("rag.subscribe", "Semantic search is desktop-only; the browser app keeps its existing RAG page."); },
    async unsubscribe() { throw unsupportedTransport("rag.unsubscribe", "Semantic search is desktop-only; the browser app keeps its existing RAG page."); },
  };
  // The browser app keeps its existing /api/help routes and pages rather than
  // routing guides through this transport.
  const help: HelpTransport = {
    async list() { throw unsupportedTransport("help.list", "The browser app reads guides from its existing help routes."); },
    async get() { throw unsupportedTransport("help.get", "The browser app reads guides from its existing help routes."); },
  };
  return { mode: "http", providers, projects, content, search, settings, runs, rag, help, chapters, world };
}

/** Kept exported for focused tests and future compatibility adapters. */
export { requestJson };
