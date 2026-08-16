import type { ExecutionProvider } from "../../shared/contracts.js";
import type { JsonValue, RunEvent, RunEventType, StructuredError } from "../../shared/contracts.js";

const EVENT_TYPES = new Set<RunEventType>([
  "run_started",
  "turn_started",
  "text_delta",
  "reasoning_delta",
  "tool_call",
  "tool_result",
  "run_completed",
  "run_failed",
  "stream_ended",
  "provider_status",
  "unknown",
  "malformed",
]);

/** Provider/core fields which must never cross the renderer trust boundary. */
const PRIVATE_KEYS = new Set([
  "raw",
  "rawline",
  "cause",
  "private",
  "metadata",
  "sessionid",
  "session_id",
  "sourcetype",
  "line",
  "timestamp",
  "command",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function safeExitCode(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function safeJson(value: unknown, seen = new WeakSet<object>(), depth = 0): JsonValue | undefined {
  if (depth > 32) return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "object" || seen.has(value)) return undefined;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const result: JsonValue[] = [];
      for (const item of value) {
        const safe = safeJson(item, seen, depth + 1);
        if (safe !== undefined) result.push(safe);
      }
      return result;
    }
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (PRIVATE_KEYS.has(key.toLowerCase())) continue;
      const safe = safeJson(item, seen, depth + 1);
      if (safe !== undefined) result[key] = safe;
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function mapError(value: unknown): StructuredError {
  if (isRecord(value)) {
    const code = safeString(value.code) ?? "PROVIDER_ERROR";
    const message = safeString(value.message) ?? "The provider reported an error";
    const result: StructuredError = {
      name: "BookWriterError",
      code: code || "PROVIDER_ERROR",
      message,
    };
    const operation = safeString(value.operation);
    if (operation) result.operation = operation;
    if (typeof value.retryable === "boolean") result.retryable = value.retryable;
    return result;
  }
  return {
    name: "BookWriterError",
    code: "PROVIDER_ERROR",
    message: typeof value === "string" && value ? value : "The provider reported an error",
  };
}

function eventType(value: unknown): RunEventType {
  return typeof value === "string" && EVENT_TYPES.has(value as RunEventType)
    ? (value as RunEventType)
    : "unknown";
}

function base(runId: string, provider: ExecutionProvider, sequence: number): RunEvent {
  return { runId, provider, sequence, type: "unknown" };
}

/**
 * Convert a core/provider event to the deliberately smaller renderer shape.
 * The provider sequence, raw payload, line, timestamp, cause, and private
 * metadata are ignored; the manager supplies the sequence separately.
 */
export function sanitizeProviderEvent(
  input: unknown,
  context: { runId: string; provider: ExecutionProvider; sequence: number },
): RunEvent {
  const source = isRecord(input) ? input : {};
  const type = eventType(source.type);
  const event = base(context.runId, context.provider, context.sequence);
  event.type = type;

  switch (type) {
    case "run_started":
      return event;
    case "turn_started":
      return event;
    case "text_delta": {
      const text = safeString(source.text);
      if (text !== undefined) event.text = text;
      if (source.role === "assistant" || source.role === "user" || source.role === "system") event.role = source.role;
      const itemId = safeString(source.itemId);
      if (itemId) event.itemId = itemId;
      return event;
    }
    case "reasoning_delta": {
      const text = safeString(source.text);
      if (text !== undefined) event.text = text;
      const itemId = safeString(source.itemId);
      if (itemId) event.itemId = itemId;
      return event;
    }
    case "tool_call": {
      const toolCallId = safeString(source.toolCallId);
      const name = safeString(source.name);
      const status = safeString(source.status);
      if (toolCallId) event.toolCallId = toolCallId;
      if (name) event.name = name;
      if (status) event.status = status;
      const inputValue = safeJson(source.input);
      if (inputValue !== undefined) event.input = inputValue;
      return event;
    }
    case "tool_result": {
      const toolCallId = safeString(source.toolCallId);
      const output = safeString(source.output);
      const status = safeString(source.status);
      if (toolCallId) event.toolCallId = toolCallId;
      if (output !== undefined) event.output = output;
      if (status) event.status = status;
      const exitCode = safeExitCode(source.exitCode);
      if (exitCode !== undefined) event.exitCode = exitCode;
      return event;
    }
    case "run_completed": {
      const result = safeString(source.result);
      if (result !== undefined) event.result = result;
      const exitCode = safeExitCode(source.exitCode);
      if (exitCode !== undefined) event.exitCode = exitCode;
      return event;
    }
    case "run_failed": {
      const result = safeString(source.result);
      if (result !== undefined) event.result = result;
      const exitCode = safeExitCode(source.exitCode);
      if (exitCode !== undefined) event.exitCode = exitCode;
      event.error = mapError(source.error);
      return event;
    }
    case "stream_ended": {
      const status = safeString(source.status);
      const exitCode = safeExitCode(source.exitCode);
      if (status) event.status = status;
      if (exitCode !== undefined) event.exitCode = exitCode;
      return event;
    }
    case "provider_status": {
      const status = safeString(source.status);
      const message = safeString(source.message);
      if (status) event.status = status;
      if (message) event.text = message;
      return event;
    }
    case "malformed":
      event.error = mapError(source.error);
      return event;
    case "unknown": {
      // Unknown provider payloads are intentionally not forwarded. A future
      // adapter must define and validate a public shape before exposing data.
      return event;
    }
    default:
      return event;
  }
}

export function providerErrorMessage(value: unknown): string {
  const error = mapError(value);
  return error.message;
}

/** Copy a desktop event so callers cannot mutate the manager's replay buffer. */
export function cloneDesktopEvent(event: RunEvent): RunEvent {
  return JSON.parse(JSON.stringify(event)) as RunEvent;
}
