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
export function isStructuredError(value: unknown): value is StructuredError {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.name === "BookWriterError" && typeof candidate.code === "string" && typeof candidate.message === "string";
}

export function toStructuredError(value: unknown, operation?: string): StructuredError {
  if (isStructuredError(value)) {
    return {
      ...value,
      ...(value.operation || !operation ? {} : { operation }),
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
