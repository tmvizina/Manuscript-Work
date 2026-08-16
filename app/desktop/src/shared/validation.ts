import { asBookWriterError, IPC_ERROR_CODES, BookWriterError } from "./errors.js";
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
  type SearchResult,
  type SettingRecord,
  type WorldDocument,
} from "./contracts.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  return value === undefined || value === null || typeof value === "string";
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isProviderStatus(value: unknown): boolean {
  return ["unknown", "checking", "ready", "not_installed", "auth_required", "unavailable", "error"].includes(String(value));
}

function isInstallStatus(value: unknown): boolean {
  return ["installed", "already_installed", "not_installed", "failed"].includes(String(value));
}

function isAuthStatus(value: unknown): boolean {
  return ["authenticated", "auth_required", "expired", "unsupported", "failed"].includes(String(value));
}

function isRunStatus(value: unknown): boolean {
  return ["queued", "starting", "running", "completed", "failed", "cancelled"].includes(String(value));
}

function isRunVariant(value: unknown): boolean {
  return value === "base" || value === "rag";
}

function isPermissionMode(value: unknown): boolean {
  return value === "default" || value === "acceptEdits" || value === "plan";
}

export function isProviderSummary(value: unknown): value is ProviderSummary {
  return isRecord(value) && isExecutionProvider(value.provider) && isProviderStatus(value.status) && isOptionalString(value.version);
}

export function isProviderSummaryList(value: unknown): value is ProviderSummary[] {
  return Array.isArray(value) && value.every(isProviderSummary);
}

export function isInstallResult(value: unknown): value is InstallResult {
  return isRecord(value) && isExecutionProvider(value.provider) && isInstallStatus(value.status) && isBoolean(value.ok) && isBoolean(value.installed);
}

export function isAuthResult(value: unknown): value is AuthResult {
  return isRecord(value) && isExecutionProvider(value.provider) && isAuthStatus(value.status) && isBoolean(value.ok) && isBoolean(value.authenticated);
}

export function isProjectSummary(value: unknown): value is ProjectSummary {
  return isRecord(value) && isNonEmptyString(value.projectId) && isNonEmptyString(value.name) && typeof value.rootPath === "string" && isBoolean(value.active);
}

export function isProjectDetail(value: unknown): value is ProjectDetail {
  if (!isProjectSummary(value)) return false;
  const detail = value as ProjectDetail;
  return isOptionalString(detail.manuscriptRoot) && isOptionalString(detail.worldRoot) && isOptionalString(detail.description);
}

export function isChapterSummary(value: unknown): value is ChapterSummary {
  return (
    isRecord(value) &&
    isNonEmptyString(value.chapterId) &&
    typeof value.book === "string" &&
    typeof value.relPath === "string" &&
    typeof value.number === "number" &&
    typeof value.title === "string" &&
    typeof value.wordCount === "number" &&
    isBoolean(value.active)
  );
}

export function isChapterSummaryList(value: unknown): value is ChapterSummary[] {
  return Array.isArray(value) && value.every(isChapterSummary);
}

export function isChapterDocument(value: unknown): value is ChapterDocument {
  if (!isChapterSummary(value)) return false;
  const document = value as ChapterDocument;
  return typeof document.text === "string" && isOptionalString(document.sha256);
}

export function isWorldDocument(value: unknown): value is WorldDocument {
  return isRecord(value) && isNonEmptyString(value.documentId) && typeof value.relPath === "string" && typeof value.text === "string" && isOptionalString(value.title);
}

export function isWorldDocumentList(value: unknown): value is WorldDocument[] {
  return Array.isArray(value) && value.every(isWorldDocument);
}

export function isRunAccepted(value: unknown): value is RunAccepted {
  return isRecord(value) && isNonEmptyString(value.runId) && isExecutionProvider(value.provider) && ["queued", "starting", "running"].includes(String(value.status));
}

export function isRunCancelResult(value: unknown): value is RunCancelResult {
  return isRecord(value) && isNonEmptyString(value.runId) && isBoolean(value.cancelled);
}

export function isRunRecord(value: unknown): value is RunRecord {
  return (
    isRecord(value) &&
    isNonEmptyString(value.runId) &&
    isExecutionProvider(value.provider) &&
    isRunVariant(value.variant) &&
    isRunStatus(value.status) &&
    typeof value.prompt === "string" &&
    isNonEmptyString(value.createdAt)
  );
}

export function isRunEvent(value: unknown): value is RunEvent {
  return (
    isRecord(value) &&
    isNonEmptyString(value.runId) &&
    isExecutionProvider(value.provider) &&
    typeof value.sequence === "number" &&
    (RUN_EVENT_TYPES as readonly string[]).includes(String(value.type)) &&
    (value.text === undefined || typeof value.text === "string") &&
    (value.input === undefined || isJsonValue(value.input)) &&
    (value.data === undefined || isJsonValue(value.data))
  );
}

export function isSearchResult(value: unknown): value is SearchResult {
  return isRecord(value) && isNonEmptyString(value.resultId) && ["chapters", "world", "reviews"].includes(String(value.scope)) && typeof value.relPath === "string" && typeof value.title === "string" && typeof value.snippet === "string";
}

export function isSearchResultList(value: unknown): value is SearchResult[] {
  return Array.isArray(value) && value.every(isSearchResult);
}

export function isSettingRecord(value: unknown): value is SettingRecord {
  return isRecord(value) && isNonEmptyString(value.projectId) && isNonEmptyString(value.key) && isJsonValue(value.value) && isNonEmptyString(value.updatedAt);
}

export function assertRequestString(value: unknown, name: string, operation: string): asserts value is string {
  if (!isNonEmptyString(value)) {
    throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: `${name} must be a non-empty string`, operation });
  }
}

export function assertRunRequest(value: unknown, operation = "runs.start"): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: "run request must be an object", operation });
  }
  assertExecutionProvider(value.provider, operation);
  assertRequestString(value.prompt, "prompt", operation);
  if (value.projectId !== undefined && value.projectId !== null) assertRequestString(value.projectId, "projectId", operation);
  if (value.skillId !== undefined && value.skillId !== null) assertRequestString(value.skillId, "skillId", operation);
  if (value.variant !== undefined && !isRunVariant(value.variant)) throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: "variant must be base or rag", operation });
  if (value.permissionMode !== undefined && !isPermissionMode(value.permissionMode)) throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: "permissionMode is invalid", operation });
}

export function parseResponse<T>(value: unknown, guard: (value: unknown) => value is T, operation: string): T {
  if (isRecord(value) && value.ok === false && value.error) throw asBookWriterError(value.error, operation);
  const candidate = isRecord(value) && value.ok === true && "value" in value ? value.value : value;
  if (!guard(candidate)) {
    throw new BookWriterError({ code: IPC_ERROR_CODES.invalidResponse, message: `IPC response for ${operation} failed validation`, operation });
  }
  return candidate;
}
