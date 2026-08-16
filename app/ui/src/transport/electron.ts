import { detectBookWriterReadOnlyBridge, type BookWriterReadOnlyBridge } from "./bridge.js";
import { invalidTransportResponse, toTransportError, TransportError } from "./errors.js";
import type {
  AuthResult,
  AuthCancelResult,
  BookWriterTransport,
  ChapterDocument,
  ChapterReadOptions,
  ChapterSummary,
  ContentTransport,
  ProjectDetail,
  ProjectProfileConfig,
  ProjectSummary,
  SearchRequest,
  SearchResult,
  ProjectSettingKey,
  ProjectSettingValue,
  SettingRecord,
  RunAccepted,
  RunEvent,
  RunRecord,
  RunRequest,
  ReviewDocument,
  ReviewSummary,
  ProviderSummary,
  WorldDocument,
  WorldSummary,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nonEmpty(value: unknown, field: string, operation: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidTransportResponse(operation, `Native response is missing ${field}`);
  }
  return value;
}

function projectSummary(value: unknown, operation: string): ProjectSummary {
  if (!isRecord(value)) throw invalidTransportResponse(operation, "Native project response is not an object");
  return {
    projectId: nonEmpty(value.projectId, "projectId", operation),
    name: nonEmpty(value.name, "name", operation),
    rootPath: nonEmpty(value.rootPath, "rootPath", operation),
    active: value.active === true,
    ...(typeof value.createdAt === "string" ? { createdAt: value.createdAt } : {}),
    ...(typeof value.updatedAt === "string" ? { updatedAt: value.updatedAt } : {}),
  };
}

function projectDetail(value: unknown, operation: string): ProjectDetail {
  if (!isRecord(value)) throw invalidTransportResponse(operation, "Native project response is not an object");
  const summary = projectSummary(value, operation);
  return {
    ...summary,
    ...(typeof value.manuscriptRoot === "string" ? { manuscriptRoot: value.manuscriptRoot } : {}),
    ...(typeof value.worldRoot === "string" ? { worldRoot: value.worldRoot } : {}),
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    ...(isProjectProfile(value.profile) ? { profile: value.profile } : {}),
    ...(value.profileSource === "default" || value.profileSource === "project" ? { profileSource: value.profileSource } : {}),
  };
}

function isProjectProfile(value: unknown): value is ProjectProfileConfig {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.memoryRoot !== "world") return false;
  return value.profile === "fantasy"
    ? value.preset === undefined && value.editorialMode === "narrative" && value.claimsPolicy === "canon" && value.memoryLabel === "World"
    : value.profile === "nonfiction" && value.preset === "fly-night-fishing" && value.editorialMode === "practical-narrative" && value.claimsPolicy === "experience-led" && value.memoryLabel === "Knowledge Base";
}

function chapterSummary(value: unknown, operation: string): ChapterSummary {
  if (!isRecord(value)) throw invalidTransportResponse(operation, "Native chapter response item is not an object");
  return {
    chapterId: nonEmpty(value.chapterId, "chapterId", operation),
    book: nonEmpty(value.book, "book", operation),
    relPath: nonEmpty(value.relPath, "relPath", operation),
    number: typeof value.number === "number" && Number.isFinite(value.number) ? value.number : 0,
    title: typeof value.title === "string" ? value.title : "",
    wordCount: typeof value.wordCount === "number" && Number.isFinite(value.wordCount) ? value.wordCount : 0,
    active: value.active === true,
    ...(typeof value.updatedAt === "string" ? { updatedAt: value.updatedAt } : {}),
  };
}

function chapterDocument(value: unknown, operation: string): ChapterDocument {
  if (!isRecord(value) || typeof value.text !== "string") {
    throw invalidTransportResponse(operation, "Native chapter response is missing text");
  }
  const summary = chapterSummary(value, operation);
  return { ...summary, text: value.text, ...(typeof value.sha256 === "string" ? { sha256: value.sha256 } : {}) };
}

function worldSummary(value: unknown, operation: string): WorldSummary {
  if (!isRecord(value)) throw invalidTransportResponse(operation, "Native world response item is not an object");
  return {
    documentId: nonEmpty(value.documentId, "documentId", operation),
    relPath: nonEmpty(value.relPath, "relPath", operation),
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.updatedAt === "string" ? { updatedAt: value.updatedAt } : {}),
  };
}

function worldDocument(value: unknown, operation: string): WorldDocument {
  if (!isRecord(value) || typeof value.text !== "string") {
    throw invalidTransportResponse(operation, "Native world response is missing text");
  }
  return { ...worldSummary(value, operation), text: value.text };
}

function reviewSummary(value: unknown, operation: string): ReviewSummary {
  const kinds = ["review", "decisions", "rewrites", "plan", "findings", "state"];
  if (!isRecord(value) || typeof value.relPath !== "string" || typeof value.name !== "string" || typeof value.ext !== "string" || !kinds.includes(String(value.kind)) || typeof value.updatedAt !== "string" || !isRecord(value.stats)) throw invalidTransportResponse(operation, "Native review response is invalid");
  return value as unknown as ReviewSummary;
}

function reviewDocument(value: unknown, operation: string): ReviewDocument {
  if (!isRecord(value) || typeof value.relPath !== "string" || typeof value.kind !== "string" || typeof value.updatedAt !== "string" || typeof value.bytes !== "number" || typeof value.text !== "string") throw invalidTransportResponse(operation, "Native review document is invalid");
  return value as unknown as ReviewDocument;
}

function searchResult(value: unknown, operation: string): SearchResult {
  if (!isRecord(value)) throw invalidTransportResponse(operation, "Native search response item is not an object");
  const scope = value.scope;
  if (scope !== "chapters" && scope !== "world" && scope !== "reviews") {
    throw invalidTransportResponse(operation, "Native search response has an invalid scope");
  }
  return {
    resultId: nonEmpty(value.resultId, "resultId", operation),
    scope,
    relPath: nonEmpty(value.relPath, "relPath", operation),
    title: typeof value.title === "string" ? value.title : "",
    snippet: typeof value.snippet === "string" ? value.snippet : "",
    ...(typeof value.score === "number" && Number.isFinite(value.score) ? { score: value.score } : {}),
  };
}

const SETTING_KEYS: readonly ProjectSettingKey[] = ["preferredProvider", "defaultModel", "permissionMode", "runVariant"];
function settingRecord(value: unknown, operation: string): SettingRecord {
  if (!isRecord(value) || typeof value.projectId !== "string" || typeof value.key !== "string" || !SETTING_KEYS.includes(value.key as ProjectSettingKey) || typeof value.updatedAt !== "string") {
    throw invalidTransportResponse(operation, "Native setting response is invalid");
  }
  return { projectId: value.projectId, key: value.key as ProjectSettingKey, value: value.value as ProjectSettingValue, updatedAt: value.updatedAt };
}

function runRecord(value: unknown, operation: string): RunRecord {
  if (!isRecord(value) || typeof value.runId !== "string" || (value.provider !== "claude" && value.provider !== "codex") || typeof value.status !== "string" || typeof value.prompt !== "string" || typeof value.createdAt !== "string" || (value.variant !== "base" && value.variant !== "rag")) {
    throw invalidTransportResponse(operation, "Native run response is invalid");
  }
  return value as unknown as RunRecord;
}

function providerSummary(value: unknown, operation: string): ProviderSummary {
  const statuses = ["unknown", "checking", "ready", "not_installed", "auth_required", "unavailable", "error"];
  if (!isRecord(value) || (value.provider !== "claude" && value.provider !== "codex") || !statuses.includes(String(value.status))) throw invalidTransportResponse(operation, "Native provider response is invalid");
  return value as unknown as ProviderSummary;
}

function authResult(value: unknown, operation: string): AuthResult {
  const statuses = ["authenticated", "auth_required", "expired", "unsupported", "failed"];
  if (!isRecord(value) || (value.provider !== "claude" && value.provider !== "codex") ||
      !statuses.includes(String(value.status)) || typeof value.ok !== "boolean" || typeof value.authenticated !== "boolean") {
    throw invalidTransportResponse(operation, "Native authentication response is invalid");
  }
  return value as unknown as AuthResult;
}

function authCancelResult(value: unknown, operation: string): AuthCancelResult {
  if (!isRecord(value) || (value.provider !== "claude" && value.provider !== "codex") || typeof value.cancelled !== "boolean") {
    throw invalidTransportResponse(operation, "Native authentication cancellation response is invalid");
  }
  return value as unknown as AuthCancelResult;
}

function requireProjectId(projectId: string | undefined, operation: string): string {
  if (typeof projectId !== "string" || projectId.trim().length === 0) {
    throw new TransportError("projectId is required by the Electron transport", {
      kind: "electron",
      code: "INVALID_ARGUMENT",
      operation,
    });
  }
  return projectId;
}

function callNative<T>(operation: string, call: () => Promise<T>, adapt: (value: T) => T): Promise<T>;
function callNative<T, U>(operation: string, call: () => Promise<T>, adapt: (value: T) => U): Promise<U>;
async function callNative<T, U>(operation: string, call: () => Promise<T>, adapt: (value: T) => U): Promise<U> {
  try {
    return adapt(await call());
  } catch (error) {
    throw toTransportError(error, operation, "electron");
  }
}

/** Build a renderer transport over the narrow, already-validated preload API. */
export function createElectronTransport(bridge: BookWriterReadOnlyBridge): BookWriterTransport {
  const providers = {
    list: () => callNative("providers.list", () => bridge.providers.list(), (value) => {
      if (!Array.isArray(value)) throw invalidTransportResponse("providers.list", "Native provider response is not an array");
      return value.map((provider) => providerSummary(provider, "providers.list"));
    }),
    status: (provider?: "claude" | "codex") => callNative("providers.status", () => bridge.providers.status(provider), (value) => {
      if (!Array.isArray(value)) throw invalidTransportResponse("providers.status", "Native provider response is not an array");
      return value.map((item) => providerSummary(item, "providers.status"));
    }),
    auth: (provider: "claude" | "codex") => callNative("providers.auth", () => bridge.providers.auth(provider), (value) =>
      authResult(value, "providers.auth")),
    cancelAuth: (provider: "claude" | "codex") => callNative("providers.authCancel", () => bridge.providers.cancelAuth(provider), (value) =>
      authCancelResult(value, "providers.authCancel")),
  };
  const projects = {
    list: () => callNative("projects.list", () => bridge.projects.list(), (value) => {
      if (!Array.isArray(value)) throw invalidTransportResponse("projects.list", "Native project response is not an array");
      return value.map((project) => projectSummary(project, "projects.list"));
    }),
    get: (projectId: string) => callNative("projects.get", () => bridge.projects.get(projectId), (value) =>
      value === null ? null : projectDetail(value, "projects.get")),
    open: (projectId: string) => callNative("projects.open", () => bridge.projects.open(projectId), (value) =>
      projectSummary(value, "projects.open")),
    import: (input: { profile: "fantasy" | "nonfiction"; preset?: "fly-night-fishing" }) => callNative("projects.import", () => bridge.projects.import(input), (value) =>
      value === null ? null : projectDetail(value, "projects.import")),
  };

  const chapters = {
    list: async (projectId?: string) => {
      const id = requireProjectId(projectId, "content.listChapters");
      return callNative("content.listChapters", () => bridge.content.listChapters(id), (value) => {
        if (!Array.isArray(value)) throw invalidTransportResponse("content.listChapters", "Native chapter response is not an array");
        return value.map((chapter) => chapterSummary(chapter, "content.listChapters"));
      });
    },
    get: async (projectId: string | undefined, chapterId: string, _options?: ChapterReadOptions) => {
      const id = requireProjectId(projectId, "content.getChapter");
      if (!chapterId) throw new TransportError("chapterId must not be empty", { kind: "electron", code: "INVALID_ARGUMENT", operation: "content.getChapter" });
      return callNative("content.getChapter", () => bridge.content.getChapter(id, chapterId), (value) => chapterDocument(value, "content.getChapter"));
    },
    refresh: async (projectId?: string) => {
      const id = requireProjectId(projectId, "content.refreshChapters");
      return callNative("content.listChapters", () => bridge.content.listChapters(id), (value) => {
        if (!Array.isArray(value)) throw invalidTransportResponse("content.listChapters", "Native chapter response is not an array");
        return value.map((chapter) => chapterSummary(chapter, "content.listChapters"));
      });
    },
  };

  const world = {
    list: async (projectId?: string) => {
      const id = requireProjectId(projectId, "content.listWorld");
      return callNative("content.listWorld", () => bridge.content.listWorld(id), (value) => {
        if (!Array.isArray(value)) throw invalidTransportResponse("content.listWorld", "Native world response is not an array");
        return value.map((entry) => worldSummary(entry, "content.listWorld"));
      });
    },
    get: async (projectId: string | undefined, relPath: string) => {
      const id = requireProjectId(projectId, "content.getWorld");
      if (!relPath) throw new TransportError("relPath must not be empty", { kind: "electron", code: "INVALID_ARGUMENT", operation: "content.getWorld" });
      return callNative("content.getWorld", () => bridge.content.getWorld(id, relPath), (value) => worldDocument(value, "content.getWorld"));
    },
  };

  const search = {
    query: async (request: SearchRequest) => {
      const projectId = requireProjectId(request?.projectId, "search.query");
      if (!request || typeof request.query !== "string" || request.query.trim().length === 0) {
        throw new TransportError("query must not be empty", { kind: "electron", code: "INVALID_ARGUMENT", operation: "search.query" });
      }
      return callNative("search.query", () => bridge.search.query({ ...request, projectId }), (value) => {
        if (!Array.isArray(value)) throw invalidTransportResponse("search.query", "Native search response is not an array");
        return value.map((entry) => searchResult(entry, "search.query"));
      });
    },
  };

  const settings = {
    get: async (projectId: string, key: ProjectSettingKey) => {
      const id = requireProjectId(projectId, "settings.get");
      return callNative("settings.get", () => bridge.settings.get(id, key), (value) => value === null ? null : settingRecord(value, "settings.get"));
    },
    set: async (projectId: string, key: ProjectSettingKey, value: ProjectSettingValue) => {
      const id = requireProjectId(projectId, "settings.set");
      return callNative("settings.set", () => bridge.settings.set(id, key, value), (result) => settingRecord(result, "settings.set"));
    },
  };

  const runs = {
    start: (request: RunRequest) => callNative("runs.start", () => bridge.runs.start(request), (value) => {
      if (!isRecord(value) || typeof value.runId !== "string" || (value.provider !== "claude" && value.provider !== "codex") || !["queued", "starting", "running"].includes(String(value.status))) throw invalidTransportResponse("runs.start", "Native run acceptance is invalid");
      return value as unknown as RunAccepted;
    }),
    list: (request?: { projectId?: string; skillId?: string; limit?: number }) => callNative("runs.list", () => bridge.runs.list(request), (value) => {
      if (!Array.isArray(value)) throw invalidTransportResponse("runs.list", "Native run history is not an array");
      return value.map((run) => runRecord(run, "runs.list"));
    }),
    get: (runId: string) => callNative("runs.get", () => bridge.runs.get(runId), (value) => runRecord(value, "runs.get")),
    cancel: (runId: string) => callNative("runs.cancel", () => bridge.runs.cancel(runId), (value) => value),
    subscribe: (runId: string, listener: (event: RunEvent) => void, options?: { afterSequence?: number }, onError?: (error: { message: string }) => void) => callNative("runs.subscribe", () => bridge.runs.subscribe(runId, listener, options, onError), (value) => value),
    unsubscribe: (subscriptionId: string) => callNative("runs.unsubscribe", () => bridge.runs.unsubscribe(subscriptionId), (value) => value),
  };

  const content: ContentTransport = {
    listChapters: chapters.list,
    getChapter: chapters.get,
    listWorld: world.list,
    getWorld: world.get,
    listReviews: async (projectId?: string) => {
      const id = requireProjectId(projectId, "content.listReviews");
      return callNative("content.listReviews", () => bridge.content.listReviews(id), (value) => {
        if (!Array.isArray(value)) throw invalidTransportResponse("content.listReviews", "Native reviews response is not an array");
        return value.map((entry) => reviewSummary(entry, "content.listReviews"));
      });
    },
    getReview: async (projectId: string | undefined, relPath: string) => {
      const id = requireProjectId(projectId, "content.getReview");
      return callNative("content.getReview", () => bridge.content.getReview(id, relPath), (value) => reviewDocument(value, "content.getReview"));
    },
  };
  return { mode: "electron", providers, projects, content, search, settings, runs, chapters, world };
}

/** Detect the bridge and construct the native transport when present. */
export function tryCreateElectronTransport(root: unknown = globalThis): BookWriterTransport | undefined {
  const bridge = detectBookWriterReadOnlyBridge(root);
  return bridge ? createElectronTransport(bridge) : undefined;
}
