export type TransportErrorKind = "http" | "electron" | "unsupported" | "invalid_response";

export interface TransportErrorOptions {
  kind: TransportErrorKind;
  code?: string;
  operation: string;
  status?: number;
  cause?: unknown;
}

/** A stable renderer error shape independent of fetch/Electron internals. */
export class TransportError extends Error {
  readonly name = "TransportError";
  readonly kind: TransportErrorKind;
  readonly code?: string;
  readonly operation: string;
  readonly status?: number;

  constructor(message: string, options: TransportErrorOptions) {
    super(message, { cause: options.cause });
    this.kind = options.kind;
    this.code = options.code;
    this.operation = options.operation;
    this.status = options.status;
  }
}

export function unsupportedTransport(operation: string, message = "This operation is unavailable in the browser transport"): TransportError {
  return new TransportError(message, { kind: "unsupported", code: "FEATURE_UNAVAILABLE", operation });
}

export function invalidTransportResponse(operation: string, message = "The transport returned an invalid response"): TransportError {
  return new TransportError(message, { kind: "invalid_response", code: "INVALID_RESPONSE", operation });
}

/** Convert a preload structured error (or an ordinary Error) at one seam. */
export function toTransportError(error: unknown, operation: string, kind: "http" | "electron"): TransportError {
  if (error instanceof TransportError) return error;

  const value = isRecord(error) ? error : undefined;
  const message = value && typeof value.message === "string" ? value.message : String(error ?? "transport request failed");
  const code = value && typeof value.code === "string" ? value.code : undefined;
  const status = value && typeof value.status === "number" ? value.status : undefined;
  return new TransportError(message, { kind, code, operation, status, cause: error });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
