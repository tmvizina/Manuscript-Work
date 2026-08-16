import { detectBookWriterReadOnlyBridge, type BookWriterReadOnlyBridge } from "./bridge.js";
import { invalidTransportResponse, toTransportError, TransportError } from "./errors.js";
import type {
  BookWriterTransport,
  ChapterDocument,
  ChapterReadOptions,
  ChapterSummary,
  ContentTransport,
  ProjectDetail,
  ProjectSummary,
  SearchRequest,
  SearchResult,
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
  };
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
  const projects = {
    list: () => callNative("projects.list", () => bridge.projects.list(), (value) => {
      if (!Array.isArray(value)) throw invalidTransportResponse("projects.list", "Native project response is not an array");
      return value.map((project) => projectSummary(project, "projects.list"));
    }),
    get: (projectId: string) => callNative("projects.get", () => bridge.projects.get(projectId), (value) =>
      value === null ? null : projectDetail(value, "projects.get")),
    open: (projectId: string) => callNative("projects.open", () => bridge.projects.open(projectId), (value) =>
      projectSummary(value, "projects.open")),
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

  const content: ContentTransport = {
    listChapters: chapters.list,
    getChapter: chapters.get,
    listWorld: world.list,
    getWorld: world.get,
  };
  return { mode: "electron", projects, content, search, chapters, world };
}

/** Detect the bridge and construct the native transport when present. */
export function tryCreateElectronTransport(root: unknown = globalThis): BookWriterTransport | undefined {
  const bridge = detectBookWriterReadOnlyBridge(root);
  return bridge ? createElectronTransport(bridge) : undefined;
}
