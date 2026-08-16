import { detectBookWriterReadOnlyBridge } from "./bridge.js";
import { createElectronTransport } from "./electron.js";
import { createHttpTransport, type HttpTransportOptions } from "./http.js";
import type { BookWriterTransport } from "./types.js";

export * from "./bridge.js";
export * from "./electron.js";
export * from "./errors.js";
export * from "./http.js";
export * from "./types.js";

export interface TransportFactoryOptions {
  /** Test/SSR seam; defaults to the current global object. */
  root?: unknown;
  http?: HttpTransportOptions;
}

/**
 * Select Electron only when the complete allow-listed read-only bridge is
 * present. Ordinary browser development therefore keeps using HTTP, and a
 * partial/malformed global cannot make the renderer call arbitrary objects.
 */
export function createTransport(options: TransportFactoryOptions = {}): BookWriterTransport {
  const bridge = detectBookWriterReadOnlyBridge(options.root ?? globalThis);
  return bridge ? createElectronTransport(bridge) : createHttpTransport(options.http);
}

export const selectTransport = createTransport;
