import { resolve } from "node:path";

/** The small structural surface used by the content sync services.
 *
 * Keeping this structural (rather than importing better-sqlite3) lets the
 * content package run in the desktop process and in tests without taking a
 * server/database dependency.
 */
export interface ContentDatabase {
  prepare(sql: string): any;
}

export interface RootOption {
  repoRoot?: string;
  manuscriptRoot?: string;
  projectRoot?: string;
}

export function asAbsoluteRoot(root: string): string {
  return resolve(root);
}

/** Match the server's second precision timestamps for stable sync records. */
export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function rootValue(value: string | RootOption, key: keyof RootOption): string {
  if (typeof value === "string") return asAbsoluteRoot(value);
  const root = value[key];
  if (!root) throw new Error(`Missing ${String(key)} for content service`);
  return asAbsoluteRoot(root);
}
