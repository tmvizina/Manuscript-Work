import type { JsonValue, StructuredError } from "./contracts.js";

export const IPC_ERROR_CODES = {
  invalidArgument: "INVALID_ARGUMENT",
  invalidResponse: "INVALID_RESPONSE",
  invokeFailed: "INVOKE_FAILED",
  malformedEvent: "MALFORMED_EVENT",
  unknown: "UNKNOWN_ERROR",
} as const;

export type IpcErrorCode = (typeof IPC_ERROR_CODES)[keyof typeof IPC_ERROR_CODES];

export class BookWriterError extends Error {
  readonly name = "BookWriterError";
  readonly code: string;
  readonly operation?: string;
  readonly retryable?: boolean;
  readonly details?: JsonValue;

  constructor(error: Omit<StructuredError, "name">) {
    super(error.message);
    this.code = error.code;
    this.operation = error.operation;
    this.retryable = error.retryable;
    this.details = error.details;
  }

  toJSON(): StructuredError {
    return {
      name: "BookWriterError",
      code: this.code,
      message: this.message,
      ...(this.operation ? { operation: this.operation } : {}),
      ...(this.retryable === undefined ? {} : { retryable: this.retryable }),
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

function isJsonValue(value: unknown, seen = new WeakSet<object>(), depth = 0): value is JsonValue {
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

function hasOnlyKeys(candidate: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(candidate).every((key) => keys.includes(key));
}

function hasStructuredErrorShape(value: unknown): value is StructuredError {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.name === "BookWriterError" &&
    typeof candidate.code === "string" &&
    candidate.code.length > 0 &&
    typeof candidate.message === "string" &&
    (candidate.operation === undefined || typeof candidate.operation === "string") &&
    (candidate.retryable === undefined || typeof candidate.retryable === "boolean") &&
    (candidate.details === undefined || isJsonValue(candidate.details))
  );
}

export function isStructuredError(value: unknown): value is StructuredError {
  return hasStructuredErrorShape(value) && hasOnlyKeys(value as unknown as Record<string, unknown>, ["name", "code", "message", "operation", "retryable", "details"]);
}

export function toStructuredError(value: unknown, operation?: string): StructuredError {
  if (hasStructuredErrorShape(value)) {
    return {
      name: "BookWriterError",
      code: value.code,
      message: value.message,
      ...(value.operation || operation ? { operation: value.operation || operation } : {}),
      ...(value.retryable === undefined ? {} : { retryable: value.retryable }),
      ...(value.details === undefined ? {} : { details: value.details }),
    };
  }
  if (value instanceof BookWriterError) return value.toJSON();
  if (value instanceof Error) {
    return {
      name: "BookWriterError",
      code: IPC_ERROR_CODES.invokeFailed,
      message: value.message || "IPC invocation failed",
      ...(operation ? { operation } : {}),
    };
  }
  return {
    name: "BookWriterError",
    code: IPC_ERROR_CODES.unknown,
    message: typeof value === "string" ? value : "Unknown IPC failure",
    ...(operation ? { operation } : {}),
  };
}

export function asBookWriterError(value: unknown, operation?: string): BookWriterError {
  const error = toStructuredError(value, operation);
  return new BookWriterError({
    code: error.code,
    message: error.message,
    ...(error.operation ? { operation: error.operation } : {}),
    ...(error.retryable === undefined ? {} : { retryable: error.retryable }),
    ...(error.details === undefined ? {} : { details: error.details }),
  });
}
