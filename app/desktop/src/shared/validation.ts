import { asBookWriterError, IPC_ERROR_CODES, BookWriterError, isStructuredError } from "./errors.js";
import {
  EXECUTION_PROVIDERS,
  type AuthCancelResult,
  type AuthResult,
  type ChapterDocument,
  type ChapterSummary,
  type ExecutionProvider,
  type InstallResult,
  type JsonValue,
  type ProjectDetail,
  type ProjectImportInput,
  type ProjectProfileConfig,
  type ProjectSummary,
  PROJECT_SETTING_KEYS,
  type ProviderSummary,
  type RunAccepted,
  type RunCancelResult,
  type RunEvent,
  type RunEventDelivery,
  RUN_EVENT_TYPES,
  RUN_REPLAY_LIMIT,
  type RunRecord,
  type RunRequest,
  type RunSubscribeRequest,
  type RunSubscriptionAccepted,
  type RunSubscriptionOptions,
  type RunUnsubscribeRequest,
  type RunUnsubscribeResult,
  type RunUsage,
  type SearchRequest,
  type SearchResult,
  type SettingValue,
  type SettingRecord,
  type WorldDocument,
  type WorldSummary,
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
  return typeof value === "string" && ["installed", "already_installed", "not_installed", "manual_action_required", "opened_external", "cancelled", "pending_approval", "failed"].includes(value);
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

export function isAuthCancelResult(value: unknown): value is AuthCancelResult {
  return isRecord(value) && hasOnlyKeys(value, ["provider", "cancelled"]) && isExecutionProvider(value.provider) && isBoolean(value.cancelled);
}

export function isProjectSummary(value: unknown): value is ProjectSummary {
  return isRecord(value) && hasOnlyKeys(value, ["projectId", "name", "rootPath", "active", "createdAt", "updatedAt"]) && isNonEmptyString(value.projectId) && isNonEmptyString(value.name) && typeof value.rootPath === "string" && isBoolean(value.active) && isOptionalString(value.createdAt) && isOptionalString(value.updatedAt);
}

export function isProjectDetail(value: unknown): value is ProjectDetail {
  if (!isRecord(value) || !hasOnlyKeys(value, ["projectId", "name", "rootPath", "active", "createdAt", "updatedAt", "manuscriptRoot", "worldRoot", "description", "profile", "profileSource"])) return false;
  const { manuscriptRoot, worldRoot, description, profile, profileSource, ...summary } = value;
  return isProjectSummary(summary) && isOptionalString(manuscriptRoot) && isOptionalString(worldRoot) && isOptionalString(description) &&
    (profile === undefined || isProjectProfileConfig(profile)) &&
    (profileSource === undefined || profileSource === "default" || profileSource === "project");
}

export function isProjectProfileConfig(value: unknown): value is ProjectProfileConfig {
  if (!isRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "profile", "preset", "editorialMode", "claimsPolicy", "memoryRoot", "memoryLabel"])) return false;
  if (value.schemaVersion !== 1 || value.memoryRoot !== "world") return false;
  if (value.profile === "fantasy") return value.preset === undefined && value.editorialMode === "narrative" && value.claimsPolicy === "canon" && value.memoryLabel === "World";
  return value.profile === "nonfiction" && value.preset === "fly-night-fishing" && value.editorialMode === "practical-narrative" && value.claimsPolicy === "experience-led" && value.memoryLabel === "Knowledge Base";
}

export function assertProjectImportInput(value: unknown, operation: string): asserts value is ProjectImportInput {
  if (!isRecord(value) || !hasOnlyKeys(value, ["profile", "preset"])) {
    throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: "project import contains unsupported fields", operation });
  }
  const valid = value.profile === "fantasy"
    ? value.preset === undefined
    : value.profile === "nonfiction" && value.preset === "fly-night-fishing";
  if (!valid) throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: "project import profile/preset is invalid", operation });
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

export function isWorldSummary(value: unknown): value is WorldSummary {
  return isRecord(value) && hasOnlyKeys(value, ["documentId", "relPath", "title", "updatedAt"]) && isNonEmptyString(value.documentId) && typeof value.relPath === "string" && isOptionalString(value.title) && isOptionalString(value.updatedAt);
}

export function isWorldSummaryList(value: unknown): value is WorldSummary[] {
  return Array.isArray(value) && value.every(isWorldSummary);
}

export function isWorldDocument(value: unknown): value is WorldDocument {
  if (!isRecord(value) || !hasOnlyKeys(value, ["documentId", "relPath", "title", "text", "updatedAt"])) return false;
  const { text, ...summary } = value;
  return isWorldSummary(summary) && typeof text === "string";
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

export function isRunRecordList(value: unknown): value is RunRecord[] {
  return Array.isArray(value) && value.every(isRunRecord);
}

export function isReviewSummaryList(value: unknown): value is import("./contracts.js").ReviewSummary[] {
  return Array.isArray(value) && value.every((item) => isRecord(item) && isNonEmptyString(item.relPath) && isNonEmptyString(item.name) && typeof item.ext === "string" && isNonEmptyString(item.kind) && isNonEmptyString(item.updatedAt) && isRecord(item.stats));
}

export function isReviewDocument(value: unknown): value is import("./contracts.js").ReviewDocument {
  return isRecord(value) && isNonEmptyString(value.relPath) && isNonEmptyString(value.kind) && isNonEmptyString(value.updatedAt) && typeof value.bytes === "number" && typeof value.text === "string";
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

export function isRunEventDelivery(value: unknown): value is RunEventDelivery {
  return isRecord(value) && hasOnlyKeys(value, ["subscriptionId", "event"]) && isNonEmptyString(value.subscriptionId) && isRunEvent(value.event);
}

export function isRunSubscriptionAccepted(value: unknown): value is RunSubscriptionAccepted {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["subscriptionId", "runId", "replayCursor", "replayTruncated", "replay"]) ||
    !isNonEmptyString(value.subscriptionId) ||
    !isNonEmptyString(value.runId) ||
    !Number.isSafeInteger(value.replayCursor) ||
    (value.replayCursor as number) < -1 ||
    !isBoolean(value.replayTruncated) ||
    !Array.isArray(value.replay) ||
    value.replay.length > RUN_REPLAY_LIMIT ||
    !value.replay.every(isRunEvent)
  ) {
    return false;
  }
  const replay = value.replay as RunEvent[];
  if (replay.some((event) => event.runId !== value.runId)) return false;
  for (let index = 1; index < replay.length; index += 1) {
    if (replay[index]!.sequence <= replay[index - 1]!.sequence) return false;
  }
  return replay.length === 0 || replay[replay.length - 1]!.sequence === value.replayCursor;
}

export function isRunUnsubscribeResult(value: unknown): value is RunUnsubscribeResult {
  return isRecord(value) && hasOnlyKeys(value, ["subscriptionId", "unsubscribed"]) && isNonEmptyString(value.subscriptionId) && isBoolean(value.unsubscribed);
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

export function assertProjectSettingValue(key: unknown, value: unknown, operation = "settings.set"): asserts value is SettingValue {
  assertRequestString(key, "key", operation);
  if (!(PROJECT_SETTING_KEYS as readonly string[]).includes(key)) {
    throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: "setting key is not allowed", operation });
  }
  assertSettingValue(value, operation);
  const valid =
    (key === "preferredProvider" && isExecutionProvider(value)) ||
    (key === "permissionMode" && isPermissionMode(value)) ||
    (key === "runVariant" && isRunVariant(value)) ||
    (key === "defaultModel" && typeof value === "string" && value.trim().length > 0 && value.length <= 128 && !value.includes("\0"));
  if (!valid) {
    throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: `value is invalid for setting ${key}`, operation });
  }
}

export function assertRunSubscriptionOptions(value: unknown, operation = "runs.subscribe"): asserts value is RunSubscriptionOptions | undefined {
  if (value === undefined) return;
  if (!isRecord(value) || !hasOnlyKeys(value, ["afterSequence"])) {
    throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: "subscription options are invalid", operation });
  }
  if (value.afterSequence !== undefined && (!Number.isSafeInteger(value.afterSequence) || (value.afterSequence as number) < -1)) {
    throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: "afterSequence must be a safe integer greater than or equal to -1", operation });
  }
}

export function assertRunSubscribeRequest(value: unknown, operation = "runs.subscribe"): asserts value is RunSubscribeRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, ["runId", "afterSequence"])) {
    throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: "subscribe request is invalid", operation });
  }
  assertRequestString(value.runId, "runId", operation);
  assertRunSubscriptionOptions(value.afterSequence === undefined ? undefined : { afterSequence: value.afterSequence }, operation);
}

export function assertRunUnsubscribeRequest(value: unknown, operation = "runs.unsubscribe"): asserts value is RunUnsubscribeRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, ["subscriptionId"])) {
    throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: "unsubscribe request is invalid", operation });
  }
  assertRequestString(value.subscriptionId, "subscriptionId", operation);
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
