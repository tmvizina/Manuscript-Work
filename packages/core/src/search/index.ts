import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  realpathSync,
  readSync,
} from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { isPathInside, resolveInside, toPosixRelative } from "../content/paths.js";

/** The scopes understood by the desktop search contract. */
export type SearchScope = "all" | "chapters" | "world" | "reviews";

export type SearchResultScope = Exclude<SearchScope, "all">;

export interface SearchRequest {
  query: string;
  scope?: SearchScope;
  limit?: number;
}

export interface ProjectSearchRequest extends SearchRequest {
  projectRoot: string;
}

/** Search results intentionally mirror the desktop IPC result shape. */
export interface SearchResult {
  resultId: string;
  scope: SearchResultScope;
  relPath: string;
  title: string;
  snippet: string;
  score?: number;
}

/**
 * Hard limits keep an accidental broad query from walking or reading an
 * unbounded manuscript on a low-end Windows machine. These are public so the
 * desktop boundary can explain a rejected request without duplicating values.
 */
export const SEARCH_LIMITS = Object.freeze({
  defaultResultLimit: 50,
  maxResultLimit: 100,
  maxQueryLength: 256,
  maxSnippetLength: 320,
  maxFileBytes: 1024 * 1024,
  maxFilesScanned: 10_000,
  maxDirectoriesScanned: 2_000,
  maxTotalReadBytes: 32 * 1024 * 1024,
});

export type SearchLimitName = keyof typeof SEARCH_LIMITS;

/** Stable error for malformed or over-budget search input. */
export class SearchInputError extends RangeError {
  readonly code = "invalidArgument" as const;

  constructor(message: string) {
    super(message);
    this.name = "SearchInputError";
  }
}

interface SearchFile {
  scope: SearchResultScope;
  path: string;
  relPath: string;
}

interface ScanBudget {
  filesScanned: number;
  directoriesScanned: number;
  bytesRead: number;
}

interface ScopeDefinition {
  scope: SearchResultScope;
  roots: readonly string[];
  extensions: ReadonlySet<string>;
}

const SCOPE_DEFINITIONS: readonly ScopeDefinition[] = [
  {
    scope: "chapters",
    roots: ["chapters", "book-2/chapters", "prequel-novella/chapters"],
    extensions: new Set([".txt"]),
  },
  {
    scope: "world",
    roots: ["world"],
    extensions: new Set([".md", ".json"]),
  },
  {
    scope: "reviews",
    roots: ["reviews", "editing-plan"],
    extensions: new Set([".md", ".json"]),
  },
] as const;

const SCOPE_ORDER = new Map<SearchResultScope, number>([
  ["chapters", 0],
  ["world", 1],
  ["reviews", 2],
]);

function fail(message: string): never {
  throw new SearchInputError(message);
}

function validateRequest(request: SearchRequest): Required<Pick<SearchRequest, "query" | "scope" | "limit">> {
  if (!request || typeof request !== "object") fail("search request must be an object");

  const { query, scope = "all", limit = SEARCH_LIMITS.defaultResultLimit } = request;
  if (typeof query !== "string") fail("query must be a string");
  if (query.trim().length === 0) fail("query must not be empty");
  if (query.length > SEARCH_LIMITS.maxQueryLength) {
    fail(`query must be at most ${SEARCH_LIMITS.maxQueryLength} characters`);
  }
  if (query.includes("\0")) fail("query must not contain a NUL character");

  if (typeof scope !== "string" || !["all", "chapters", "world", "reviews"].includes(scope)) {
    fail("scope is invalid");
  }
  if (!Number.isSafeInteger(limit) || limit < 1) fail("limit must be a positive integer");
  if (limit > SEARCH_LIMITS.maxResultLimit) {
    fail(`limit must be at most ${SEARCH_LIMITS.maxResultLimit}`);
  }

  return { query, scope: scope as SearchScope, limit };
}

function projectRootValue(projectRoot: string): string | null {
  if (typeof projectRoot !== "string" || projectRoot.length === 0 || projectRoot.includes("\0")) {
    fail("projectRoot must be a non-empty path");
  }

  const requested = resolve(projectRoot);
  if (!existsSync(requested)) return null;

  // A trusted project root is expected to be a real directory. Refusing a
  // symlink here avoids silently changing the scope to a different tree.
  let rootStat;
  try {
    rootStat = lstatSync(requested);
  } catch {
    return null;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null;

  try {
    return realpathSync(requested);
  } catch {
    return null;
  }
}

function scopeDefinitions(scope: SearchScope): readonly ScopeDefinition[] {
  return scope === "all" ? SCOPE_DEFINITIONS : SCOPE_DEFINITIONS.filter((definition) => definition.scope === scope);
}

function safeRealPath(root: string, candidate: string): string | null {
  const requested = resolveInside(root, toPosixRelative(root, candidate), false);
  if (!requested) return null;

  let stat;
  try {
    stat = lstatSync(requested);
  } catch {
    return null;
  }
  if (stat.isSymbolicLink()) return null;

  let real;
  try {
    real = realpathSync(requested);
  } catch {
    return null;
  }
  return isPathInside(root, real, false) ? real : null;
}

function lexicalCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function extensionAllowed(path: string, extensions: ReadonlySet<string>): boolean {
  return extensions.has(extname(path).toLowerCase());
}

function collectFiles(
  projectRoot: string,
  definition: ScopeDefinition,
  budget: ScanBudget,
  files: SearchFile[],
): void {
  const seenDirectories = new Set<string>();
  const walk = (directory: string): void => {
    if (budget.directoriesScanned >= SEARCH_LIMITS.maxDirectoriesScanned) return;
    const realDirectory = safeRealPath(projectRoot, directory);
    if (!realDirectory || seenDirectories.has(realDirectory)) return;
    seenDirectories.add(realDirectory);
    budget.directoriesScanned++;

    let entries;
    try {
      entries = readdirSync(realDirectory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => lexicalCompare(a.name, b.name));

    for (const entry of entries) {
      if (budget.filesScanned >= SEARCH_LIMITS.maxFilesScanned) return;
      // Count every entry so a tree full of unsupported files cannot bypass
      // the traversal budget.
      budget.filesScanned++;
      const child = resolveInside(projectRoot, toPosixRelative(projectRoot, join(realDirectory, entry.name)), false);
      if (!child) continue;

      // Dirent.isSymbolicLink catches ordinary links and lstat catches links
      // created or swapped after readdir. Neither files nor directories below
      // a link are followed.
      if (entry.isSymbolicLink()) continue;
      let childStat;
      try {
        childStat = lstatSync(child);
      } catch {
        continue;
      }
      if (childStat.isSymbolicLink()) continue;

      const realChild = safeRealPath(projectRoot, child);
      if (!realChild) continue;
      if (childStat.isDirectory()) {
        walk(realChild);
        continue;
      }
      if (!childStat.isFile() || !extensionAllowed(realChild, definition.extensions)) continue;

      files.push({
        scope: definition.scope,
        path: realChild,
        relPath: toPosixRelative(projectRoot, realChild),
      });
    }
  };

  for (const rootRelative of definition.roots) {
    if (budget.filesScanned >= SEARCH_LIMITS.maxFilesScanned) return;
    const rootPath = resolveInside(projectRoot, rootRelative, false);
    if (!rootPath) continue;
    walk(rootPath);
  }
}

function readBoundedUtf8(filePath: string, budget: ScanBudget): string | null {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(filePath, "r");
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > SEARCH_LIMITS.maxFileBytes) return null;
    if (budget.bytesRead + stat.size > SEARCH_LIMITS.maxTotalReadBytes) return null;

    const buffer = Buffer.allocUnsafe(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const read = readSync(descriptor, buffer, offset, buffer.length - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    budget.bytesRead += offset;
    return buffer.subarray(0, offset).toString("utf8");
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // The file may have disappeared between read and close; search can
        // safely omit that result.
      }
    }
  }
}

function countOccurrences(text: string, query: string): { first: number; count: number } {
  let first = -1;
  let count = 0;
  let offset = 0;
  while (offset <= text.length - query.length) {
    const found = text.indexOf(query, offset);
    if (found < 0) break;
    if (first < 0) first = found;
    count++;
    offset = found + query.length;
  }
  return { first, count };
}

function titleFor(relPath: string, text: string): string {
  const heading = text.match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.trim();
  if (heading) return heading;
  const fileName = basename(relPath);
  const extension = extname(fileName);
  return extension ? fileName.slice(0, -extension.length) : fileName;
}

function snippetFor(text: string, offset: number, queryLength: number): string {
  const context = 96;
  let start = Math.max(0, offset - context);
  let end = Math.min(text.length, start + SEARCH_LIMITS.maxSnippetLength);
  const matchEnd = offset + queryLength;
  if (matchEnd > end) {
    end = Math.min(text.length, matchEnd);
    start = Math.max(0, end - SEARCH_LIMITS.maxSnippetLength);
  }
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

function resultFor(file: SearchFile, text: string, query: string, queryLower: string): SearchResult | null {
  const match = countOccurrences(text.toLowerCase(), queryLower);
  if (match.first < 0) return null;

  return {
    resultId: `${file.scope}:${file.relPath}`,
    scope: file.scope,
    relPath: file.relPath,
    title: titleFor(file.relPath, text),
    snippet: snippetFor(text, match.first, query.length),
    score: match.count,
  };
}

/**
 * Search supported manuscript files below one trusted project root.
 *
 * Matching is case-insensitive substring matching; the query is never
 * interpreted as a regular expression. A result represents one source file,
 * ordered by scope and POSIX relative path, and contains the first match.
 */
export function searchProject(projectRoot: string, request: SearchRequest): SearchResult[];
export function searchProject(request: ProjectSearchRequest): SearchResult[];
export function searchProject(
  projectRootOrRequest: string | ProjectSearchRequest,
  maybeRequest?: SearchRequest,
): SearchResult[] {
  const projectRoot = typeof projectRootOrRequest === "string" ? projectRootOrRequest : projectRootOrRequest.projectRoot;
  const request = typeof projectRootOrRequest === "string" ? maybeRequest : projectRootOrRequest;
  if (!request) fail("search request must be provided");
  const { query, scope, limit } = validateRequest(request);
  const root = projectRootValue(projectRoot);
  if (!root) return [];

  const queryLower = query.toLowerCase();
  const budget: ScanBudget = { filesScanned: 0, directoriesScanned: 0, bytesRead: 0 };
  const files: SearchFile[] = [];
  for (const definition of scopeDefinitions(scope)) {
    collectFiles(root, definition, budget, files);
    if (budget.filesScanned >= SEARCH_LIMITS.maxFilesScanned) break;
  }

  files.sort(
    (a, b) =>
      (SCOPE_ORDER.get(a.scope) ?? 0) - (SCOPE_ORDER.get(b.scope) ?? 0) || lexicalCompare(a.relPath, b.relPath),
  );

  const results: SearchResult[] = [];
  for (const file of files) {
    if (results.length >= limit) break;
    const text = readBoundedUtf8(file.path, budget);
    if (text === null) continue;
    const result = resultFor(file, text, query, queryLower);
    if (result) results.push(result);
  }
  return results;
}

/** A convenient injected service for main-process composition. */
export class ProjectSearchService {
  constructor(readonly projectRoot: string) {}

  query(request: SearchRequest): SearchResult[] {
    return searchProject(this.projectRoot, request);
  }
}

/** Descriptive aliases for callers that prefer an operation-oriented name. */
export const queryProject = searchProject;
export const searchFiles = searchProject;
