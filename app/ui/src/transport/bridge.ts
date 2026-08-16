import type {
  ChapterDocument,
  ChapterSummary,
  ProjectDetail,
  ProjectSummary,
  SearchRequest,
  SearchResult,
  WorldDocument,
  WorldSummary,
} from "./types.js";

/**
 * The subset of the preload bridge used by Phase 3. This is structural on
 * purpose: the UI does not import Electron, the preload implementation, or
 * the desktop package at runtime.
 */
export interface BookWriterReadOnlyBridge {
  readonly projects: {
    list(): Promise<ProjectSummary[]>;
    get(projectId: string): Promise<ProjectDetail | null>;
    open(projectId: string): Promise<ProjectSummary>;
  };
  readonly content: {
    listChapters(projectId: string): Promise<ChapterSummary[]>;
    getChapter(projectId: string, chapterId: string): Promise<ChapterDocument>;
    listWorld(projectId: string): Promise<WorldSummary[]>;
    getWorld(projectId: string, relPath: string): Promise<WorldDocument>;
  };
  readonly search: {
    query(request: SearchRequest & { projectId: string }): Promise<SearchResult[]>;
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
  const content = value.content;
  const search = value.search;
  return (
    hasMethods(projects, ["list", "get", "open"]) &&
    hasMethods(content, ["listChapters", "getChapter", "listWorld", "getWorld"]) &&
    hasMethods(search, ["query"])
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
