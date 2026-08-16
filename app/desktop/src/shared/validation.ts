import { asBookWriterError, IPC_ERROR_CODES, BookWriterError, isStructuredError } from "./errors.js";
import {
  EXECUTION_PROVIDERS,
  type AuthResult,
  type ChapterDocument,
  type ChapterSummary,
  type ExecutionProvider,
  type InstallResult,
  type JsonValue,
  type ProjectDetail,
  type ProjectSummary,
  type ProviderSummary,
  type RunAccepted,
  type RunCancelResult,
  type RunEvent,
  RUN_EVENT_TYPES,
  type RunRecord,
  type RunRequest,
  type RunUsage,
  type SearchRequest,
  type SearchResult,
  type SettingValue,
  type SettingRecord,
  type WorldDocument,
} from "./contracts.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isExecutionProvider(value: unknown): value is ExecutionProvider {
  return typeof value === "string" && (EXECUTION_PROVIDERS as readonly string[]).includes(value);
}

export function assertExecutionProvider(value: unknown, operation: string): asserts value is ExecutionProvider {
  if (!isExecutionProvider(value)) {
    throw new BookWriterError({
      code: IPC_ERROR_CODES.invalidArgument,
      message: "provider must be claude or codex",
      operation,
    });
  }
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function isOptionalNonNegativeNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

export function isJsonValue(value: unknown, seen = new WeakSet<object>(), depth = 0): value is JsonValue {
  if (depth > 64) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen, depth + 1))
    : Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every((item) => isJsonValue(item, seen, depth + 1));
  seen.delete(value);
  return valid;
}

function isProviderStatus(value: unknown): boolean {
  return typeof value === "string" && ["unknown", "checking", "ready", "not_installed", "auth_required", "unavailable", "error"].includes(value);
}

function isInstallStatus(value: unknown): boolean {
  return typeof value === "string" && ["installed", "already_installed", "not_installed", "failed"].includes(value);
}

function isAuthStatus(value: unknown): boolean {
  return typeof value === "string" && ["authenticated", "auth_required", "expired", "unsupported", "failed"].includes(value);
}

function isRunStatus(value: unknown): boolean {
  return typeof value === "string" && ["queued", "starting", "running", "completed", "failed", "cancelled"].includes(value);
}

function isRunVariant(value: unknown): boolean {
  return value === "base" || value === "rag";
}

function isPermissionMode(value: unknown): boolean {
  return value === "default" || value === "acceptEdits" || value === "plan";
}

export function isProviderSummary(value: unknown): value is ProviderSummary {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["provider", "status", "version", "executablePath", "account", "message", "checkedAt"]) &&
    isExecutionProvider(value.provider) &&
    isProviderStatus(value.status) &&
    isOptionalString(value.version) &&
    isOptionalString(value.executablePath) &&
    isOptionalString(value.account) &&
    isOptionalString(value.message) &&
    isOptionalString(value.checkedAt)
  );
}

export function isProviderSummaryList(value: unknown): value is ProviderSummary[] {
  return Array.isArray(value) && value.every(isProviderSummary);
}

export function isInstallResult(value: unknown): value is InstallResult {
  return isRecord(value) && hasOnlyKeys(value, ["provider", "status", "ok", "installed", "version", "executablePath", "message"]) && isExecutionProvider(value.provider) && isInstallStatus(value.status) && isBoolean(value.ok) && isBoolean(value.installed) && isOptionalString(value.version) && isOptionalString(value.executablePath) && isOptionalString(value.message);
}

export function isAuthResult(value: unknown): value is AuthResult {
  return isRecord(value) && hasOnlyKeys(value, ["provider", "status", "ok", "authenticated", "account", "expiresAt", "message"]) && isExecutionProvider(value.provider) && isAuthStatus(value.status) && isBoolean(value.ok) && isBoolean(value.authenticated) && isOptionalString(value.account) && isOptionalString(value.expiresAt) && isOptionalString(value.message);
}

export function isProjectSummary(value: unknown): value is ProjectSummary {
  return isRecord(value) && hasOnlyKeys(value, ["projectId", "name", "rootPath", "active", "createdAt", "updatedAt"]) && isNonEmptyString(value.projectId) && isNonEmptyString(value.name) && typeof value.rootPath === "string" && isBoolean(value.active) && isOptionalString(value.createdAt) && isOptionalString(value.updatedAt);
}

export function isProjectDetail(value: unknown): value is ProjectDetail {
  if (!isRecord(value) || !hasOnlyKeys(value, ["projectId", "name", "rootPath", "active", "createdAt", "updatedAt", "manuscriptRoot", "worldRoot", "description"])) return false;
  const { manuscriptRoot, worldRoot, description, ...summary } = value;
  return isProjectSummary(summary) && isOptionalString(manuscriptRoot) && isOptionalString(worldRoot) && isOptionalString(description);
}

export function isChapterSummary(value: unknown): value is ChapterSummary {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["chapterId", "book", "relPath", "number", "title", "wordCount", "active", "updatedAt"]) &&
    isNonEmptyString(value.chapterId) &&
    typeof value.book === "string" &&
    typeof value.relPath === "string" &&
    typeof value.number === "number" &&
    Number.isFinite(value.number) &&
    typeof value.title === "string" &&
    typeof value.wordCount === "number" &&
    Number.isFinite(value.wordCount) &&
    Number.isInteger(value.wordCount) &&
    value.wordCount >= 0 &&
    isBoolean(value.active) &&
    isOptionalString(value.updatedAt)
  );
}

export function isChapterSummaryList(value: unknown): value is ChapterSummary[] {
  return Array.isArray(value) && value.every(isChapterSummary);
}

export function isChapterDocument(value: unknown): value is ChapterDocument {
  if (!isRecord(value) || !hasOnlyKeys(value, ["chapterId", "book", "relPath", "number", "title", "wordCount", "active", "updatedAt", "text", "sha256"])) return false;
  const { text, sha256, ...summary } = value;
  return isChapterSummary(summary) && typeof text === "string" && isOptionalString(sha256);
}

export function isWorldDocument(value: unknown): value is WorldDocument {
  return isRecord(value) && hasOnlyKeys(value, ["documentId", "relPath", "title", "text", "updatedAt"]) && isNonEmptyString(value.documentId) && typeof value.relPath === "string" && typeof value.text === "string" && isOptionalString(value.title) && isOptionalString(value.updatedAt);
}

export function isWorldDocumentList(value: unknown): value is WorldDocument[] {
  return Array.isArray(value) && value.every(isWorldDocument);
}

export function isRunAccepted(value: unknown): value is RunAccepted {
  return isRecord(value) && hasOnlyKeys(value, ["runId", "provider", "status"]) && isNonEmptyString(value.runId) && isExecutionProvider(value.provider) && typeof value.status === "string" && ["queued", "starting", "running"].includes(value.status);
}

export function isRunCancelResult(value: unknown): value is RunCancelResult {
  return isRecord(value) && hasOnlyKeys(value, ["runId", "cancelled"]) && isNonEmptyString(value.runId) && isBoolean(value.cancelled);
}

function isRunUsage(value: unknown): value is RunUsage {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["inputTokens", "outputTokens", "cachedInputTokens", "totalTokens", "durationMs", "totalCostUsd"]) &&
    isOptionalNonNegativeNumber(value.inputTokens) &&
    isOptionalNonNegativeNumber(value.outputTokens) &&
    isOptionalNonNegativeNumber(value.cachedInputTokens) &&
    isOptionalNonNegativeNumber(value.totalTokens) &&
    isOptionalNonNegativeNumber(value.durationMs) &&
    isOptionalNonNegativeNumber(value.totalCostUsd)
  );
}

export function isRunRecord(value: unknown): value is RunRecord {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["runId", "projectId", "provider", "model", "skillId", "variant", "status", "prompt", "resultText", "error", "usage", "transcriptPath", "createdAt", "startedAt", "finishedAt"]) &&
    isNonEmptyString(value.runId) &&
    isExecutionProvider(value.provider) &&
    isRunVariant(value.variant) &&
    isRunStatus(value.status) &&
    typeof value.prompt === "string" &&
    isNonEmptyString(value.createdAt) &&
    isOptionalNullableString(value.projectId) &&
    isOptionalString(value.model) &&
    isOptionalNullableString(value.skillId) &&
    isOptionalString(value.resultText) &&
    isOptionalString(value.error) &&
    isOptionalString(value.transcriptPath) &&
    isOptionalString(value.startedAt) &&
    isOptionalString(value.finishedAt) &&
    (value.usage === undefined || isRunUsage(value.usage))
  );
}

export function isRunEvent(value: unknown): value is RunEvent {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["runId", "provider", "sequence", "type", "text", "role", "itemId", "toolCallId", "name", "input", "output", "status", "result", "error", "exitCode", "data"]) &&
    isNonEmptyString(value.runId) &&
    isExecutionProvider(value.provider) &&
    typeof value.sequence === "number" &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 0 &&
    typeof value.type === "string" &&
    (RUN_EVENT_TYPES as readonly string[]).includes(value.type) &&
    (value.text === undefined || typeof value.text === "string") &&
    (value.role === undefined || (typeof value.role === "string" && ["assistant", "user", "system"].includes(value.role))) &&
    isOptionalString(value.itemId) &&
    isOptionalString(value.toolCallId) &&
    isOptionalString(value.name) &&
    (value.input === undefined || isJsonValue(value.input)) &&
    isOptionalString(value.output) &&
    isOptionalString(value.status) &&
    isOptionalString(value.result) &&
    (value.error === undefined || isStructuredError(value.error)) &&
    (value.exitCode === undefined || value.exitCode === null || (typeof value.exitCode === "number" && Number.isSafeInteger(value.exitCode))) &&
    (value.data === undefined || isJsonValue(value.data))
  );
}

export function isSearchResult(value: unknown): value is SearchResult {
  return isRecord(value) && hasOnlyKeys(value, ["resultId", "scope", "relPath", "title", "snippet", "score"]) && isNonEmptyString(value.resultId) && typeof value.scope === "string" && ["chapters", "world", "reviews"].includes(value.scope) && typeof value.relPath === "string" && typeof value.title === "string" && typeof value.snippet === "string" && (value.score === undefined || (typeof value.score === "number" && Number.isFinite(value.score)));
}

export function isSearchResultList(value: unknown): value is SearchResult[] {
  return Array.isArray(value) && value.every(isSearchResult);
}

export function isSettingRecord(value: unknown): value is SettingRecord {
  return isRecord(value) && hasOnlyKeys(value, ["projectId", "key", "value", "updatedAt"]) && isNonEmptyString(value.projectId) && isNonEmptyString(value.key) && isJsonValue(value.value) && isNonEmptyString(value.updatedAt);
}

export function assertSearchRequest(value: unknown, operation = "search.query"): asserts value is SearchRequest {
  if (!isRecord(value)) {
    throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: "search request must be an object", operation });
  }
  if (!hasOnlyKeys(value, ["projectId", "query", "scope", "limit"])) {
    throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: "search request contains unsupported fields", operation });
  }
  assertRequestString(value.projectId, "projectId", operation);
  assertRequestString(value.query, "query", operation);
  if (value.scope !== undefined && (typeof value.scope !== "string" || !["all", "chapters", "world", "reviews"].includes(value.scope))) {
    throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: "scope is invalid", operation });
  }
  if (value.limit !== undefined && (!Number.isSafeInteger(value.limit) || (value.limit as number) < 1)) {
    throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: "limit must be a positive integer", operation });
  }
}

export function assertSettingValue(value: unknown, operation = "settings.set"): asserts value is SettingValue {
  if (!isJsonValue(value)) {
    throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: "value must be JSON-serializable", operation });
  }
}

export function assertRequestString(value: unknown, name: string, operation: string): asserts value is string {
  if (!isNonEmptyString(value)) {
    throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: `${name} must be a non-empty string`, operation });
  }
}

export function assertRunRequest(value: unknown, operation = "runs.start"): asserts value is RunRequest {
  if (!isRecord(value)) {
    throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: "run request must be an object", operation });
  }
  if (!hasOnlyKeys(value, ["provider", "prompt", "projectId", "skillId", "variant", "permissionMode", "model"])) {
    throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: "run request contains unsupported fields", operation });
  }
  assertExecutionProvider(value.provider, operation);
  assertRequestString(value.prompt, "prompt", operation);
  if (value.projectId !== undefined && value.projectId !== null) assertRequestString(value.projectId, "projectId", operation);
  if (value.skillId !== undefined && value.skillId !== null) assertRequestString(value.skillId, "skillId", operation);
  if (value.variant !== undefined && !isRunVariant(value.variant)) throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: "variant must be base or rag", operation });
  if (value.permissionMode !== undefined && !isPermissionMode(value.permissionMode)) throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: "permissionMode is invalid", operation });
  if (value.model !== undefined) assertRequestString(value.model, "model", operation);
}

export function parseResponse<T>(value: unknown, guard: (value: unknown) => value is T, operation: string): T {
  if (isRecord(value) && value.ok === false && "error" in value) throw asBookWriterError(value.error, operation);
  const candidate = isRecord(value) && value.ok === true && "value" in value ? value.value : value;
  if (!guard(candidate)) {
    throw new BookWriterError({ code: IPC_ERROR_CODES.invalidResponse, message: `IPC response for ${operation} failed validation`, operation });
  }
  return candidate;
}
