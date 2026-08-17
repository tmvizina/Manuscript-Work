import { createHash } from "node:crypto";
import { readFile as readFileFromDisk } from "node:fs/promises";
import type { ExecutionProvider } from "../../shared/contracts.js";

/** The only payload target supported by the offline installer. */
export const PROVIDER_PAYLOAD_PLATFORM = "windows-x64" as const;
export type ProviderPayloadPlatform = typeof PROVIDER_PAYLOAD_PLATFORM;

export const PROVIDER_PAYLOAD_SCHEMA_VERSION = 1 as const;

/**
 * Release approval is deliberately explicit.  A payload is not eligible for
 * installation unless both the redistribution and publisher checks have been
 * recorded by release engineering.
 */
export interface ProviderPayloadApproval {
  redistributionApproved: true;
  publisherVerified: true;
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
}

/**
 * The checked-in, release-owned description of one provider payload.
 *
 * This type contains metadata only.  It does not describe a download or an
 * installer action; the verifier only reads a caller-supplied local file and
 * compares its SHA-256 to this record.
 */
export interface ProviderPayloadManifest {
  schemaVersion: typeof PROVIDER_PAYLOAD_SCHEMA_VERSION;
  provider: ExecutionProvider;
  version: string;
  platform: ProviderPayloadPlatform;
  sourceUrl: string;
  license: string;
  publisher: string;
  sha256: string;
  approval: ProviderPayloadApproval;
}

export type PayloadManifestErrorCode =
  | "manifest_parse_failed"
  | "manifest_not_object"
  | "manifest_unknown_key"
  | "manifest_missing_field"
  | "manifest_field_invalid"
  | "manifest_unapproved"
  | "manifest_not_yet_active"
  | "manifest_stale"
  | "manifest_source_unapproved"
  | "manifest_mismatch"
  | "payload_path_invalid"
  | "payload_read_failed"
  | "payload_hash_failed"
  | "payload_hash_mismatch";

/** A stable, non-secret error from manifest parsing or local verification. */
export class ProviderPayloadManifestError extends Error {
  readonly code: PayloadManifestErrorCode;
  readonly field?: string;

  constructor(code: PayloadManifestErrorCode, message: string, field?: string) {
    super(message);
    this.name = "ProviderPayloadManifestError";
    this.code = code;
    this.field = field;
  }
}

export type PayloadReadFile = (path: string) => Promise<Uint8Array> | Uint8Array;
export type PayloadSha256 = (bytes: Uint8Array) => Promise<string> | string;

export interface ProviderPayloadVerifierOptions {
  /** Injected in tests and in the eventual installer; never a network reader. */
  readFile?: PayloadReadFile;
  /** Injected hash implementation, kept separate from filesystem access. */
  sha256?: PayloadSha256;
  /** A clock seam makes approval expiry deterministic and auditable. */
  now?: () => Date | number | string;
  /** Optional release-policy allow-list for official source hosts. */
  allowedSourceHosts?: Partial<Record<ExecutionProvider, readonly string[]>>;
}

export interface ProviderPayloadExpectation {
  provider?: ExecutionProvider;
  version?: string;
  platform?: ProviderPayloadPlatform;
}

export interface VerifiedProviderPayload {
  manifest: ProviderPayloadManifest;
  payloadPath: string;
  /** Lower-case SHA-256 of the bytes read from payloadPath. */
  computedSha256: string;
}

const MANIFEST_KEYS = [
  "approval",
  "license",
  "platform",
  "provider",
  "publisher",
  "schemaVersion",
  "sha256",
  "sourceUrl",
  "version",
].sort();

const APPROVAL_KEYS = [
  "approvedAt",
  "approvedBy",
  "expiresAt",
  "publisherVerified",
  "redistributionApproved",
].sort();

const PROVIDERS: readonly ExecutionProvider[] = ["claude", "codex"];
const MAX_VERSION_LENGTH = 128;
const MAX_SOURCE_URL_LENGTH = 2_048;
const MAX_LICENSE_LENGTH = 512;
const MAX_PUBLISHER_LENGTH = 256;
const MAX_APPROVED_BY_LENGTH = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sortedKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).sort();
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
  const actual = sortedKeys(value);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    const unexpected = actual.find((key) => !expected.includes(key));
    if (unexpected) {
      throw new ProviderPayloadManifestError(
        "manifest_unknown_key",
        `${path} contains an unsupported field`,
        `${path}.${unexpected}`,
      );
    }
    const missing = expected.find((key) => !actual.includes(key));
    throw new ProviderPayloadManifestError(
      "manifest_missing_field",
      `${path} is missing a required field`,
      `${path}.${missing ?? "unknown"}`,
    );
  }
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ProviderPayloadManifestError("manifest_field_invalid", `${field} must be a bounded text value`, field);
  }
  return value;
}

function isoTimestamp(value: unknown, field: string): string {
  const text = requiredString(value, field, 64);
  // Approval timestamps are release metadata and must be unambiguous UTC.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(text) || !Number.isFinite(Date.parse(text))) {
    throw new ProviderPayloadManifestError("manifest_field_invalid", `${field} must be an ISO-8601 UTC timestamp`, field);
  }
  return text;
}

function parseJsonInput(input: unknown): unknown {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input) as unknown;
  } catch {
    throw new ProviderPayloadManifestError("manifest_parse_failed", "Provider payload manifest is not valid JSON");
  }
}

function parseApproval(value: unknown): ProviderPayloadApproval {
  if (!isRecord(value)) {
    throw new ProviderPayloadManifestError("manifest_field_invalid", "approval must be an object", "approval");
  }
  hasExactKeys(value, APPROVAL_KEYS, "approval");
  if (value.redistributionApproved !== true || value.publisherVerified !== true) {
    throw new ProviderPayloadManifestError(
      "manifest_unapproved",
      "Provider payload redistribution and publisher approval are required",
      "approval",
    );
  }
  const approvedBy = requiredString(value.approvedBy, "approval.approvedBy", MAX_APPROVED_BY_LENGTH);
  const approvedAt = isoTimestamp(value.approvedAt, "approval.approvedAt");
  const expiresAt = isoTimestamp(value.expiresAt, "approval.expiresAt");
  if (Date.parse(expiresAt) <= Date.parse(approvedAt)) {
    throw new ProviderPayloadManifestError(
      "manifest_field_invalid",
      "approval.expiresAt must be later than approval.approvedAt",
      "approval.expiresAt",
    );
  }
  return { redistributionApproved: true, publisherVerified: true, approvedBy, approvedAt, expiresAt };
}

function validateSourceUrl(value: unknown): string {
  const sourceUrl = requiredString(value, "sourceUrl", MAX_SOURCE_URL_LENGTH);
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new ProviderPayloadManifestError("manifest_field_invalid", "sourceUrl must be a valid HTTPS URL", "sourceUrl");
  }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password || parsed.hash) {
    throw new ProviderPayloadManifestError("manifest_field_invalid", "sourceUrl must be a credential-free HTTPS URL", "sourceUrl");
  }
  return parsed.toString();
}

function validateManifestValue(value: unknown): ProviderPayloadManifest {
  if (!isRecord(value)) {
    throw new ProviderPayloadManifestError("manifest_not_object", "Provider payload manifest must be an object");
  }
  hasExactKeys(value, MANIFEST_KEYS, "manifest");
  if (value.schemaVersion !== PROVIDER_PAYLOAD_SCHEMA_VERSION) {
    throw new ProviderPayloadManifestError("manifest_field_invalid", "Unsupported provider payload manifest schema", "schemaVersion");
  }
  if (!PROVIDERS.includes(value.provider as ExecutionProvider)) {
    throw new ProviderPayloadManifestError("manifest_field_invalid", "provider must be claude or codex", "provider");
  }
  const version = requiredString(value.version, "version", MAX_VERSION_LENGTH);
  if (!/^[A-Za-z0-9][A-Za-z0-9._+\-]{0,127}$/u.test(version)) {
    throw new ProviderPayloadManifestError("manifest_field_invalid", "version contains unsupported characters", "version");
  }
  if (value.platform !== PROVIDER_PAYLOAD_PLATFORM) {
    throw new ProviderPayloadManifestError("manifest_field_invalid", "Only windows-x64 payloads are supported", "platform");
  }
  const sourceUrl = validateSourceUrl(value.sourceUrl);
  const license = requiredString(value.license, "license", MAX_LICENSE_LENGTH);
  const publisher = requiredString(value.publisher, "publisher", MAX_PUBLISHER_LENGTH);
  if (typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/iu.test(value.sha256)) {
    throw new ProviderPayloadManifestError("manifest_field_invalid", "sha256 must be a 64-character hexadecimal digest", "sha256");
  }
  return {
    schemaVersion: PROVIDER_PAYLOAD_SCHEMA_VERSION,
    provider: value.provider as ExecutionProvider,
    version,
    platform: PROVIDER_PAYLOAD_PLATFORM,
    sourceUrl,
    license,
    publisher,
    sha256: value.sha256.toLowerCase(),
    approval: parseApproval(value.approval),
  };
}

/** Parse and strictly validate a release-owned manifest; no filesystem access occurs. */
export function parseProviderPayloadManifest(input: unknown): ProviderPayloadManifest {
  return validateManifestValue(parseJsonInput(input));
}

function defaultSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function defaultNow(): Date {
  return new Date();
}

function resolveNow(now: () => Date | number | string): number {
  const value = now();
  const timestamp = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new ProviderPayloadManifestError("manifest_field_invalid", "Verifier clock returned an invalid time");
  return timestamp;
}

function validateUsableManifest(
  manifest: ProviderPayloadManifest,
  now: () => Date | number | string,
  allowedSourceHosts: Partial<Record<ExecutionProvider, readonly string[]>> | undefined,
): void {
  const nowMs = resolveNow(now);
  const approvedAtMs = Date.parse(manifest.approval.approvedAt);
  const expiresAtMs = Date.parse(manifest.approval.expiresAt);
  if (approvedAtMs > nowMs) {
    throw new ProviderPayloadManifestError("manifest_not_yet_active", "Provider payload approval is not active yet", "approval.approvedAt");
  }
  if (expiresAtMs <= nowMs) {
    throw new ProviderPayloadManifestError("manifest_stale", "Provider payload approval has expired", "approval.expiresAt");
  }
  if (manifest.approval.redistributionApproved !== true || manifest.approval.publisherVerified !== true) {
    throw new ProviderPayloadManifestError("manifest_unapproved", "Provider payload approval is incomplete", "approval");
  }
  const allowedHosts = allowedSourceHosts?.[manifest.provider];
  if (allowedHosts && !allowedHosts.some((host) => host.toLowerCase() === new URL(manifest.sourceUrl).hostname.toLowerCase())) {
    throw new ProviderPayloadManifestError("manifest_source_unapproved", "Provider payload source is not on the approved host list", "sourceUrl");
  }
}

function assertExpectation(manifest: ProviderPayloadManifest, expected: ProviderPayloadExpectation | undefined): void {
  if (!expected) return;
  if (expected.provider !== undefined && expected.provider !== manifest.provider) {
    throw new ProviderPayloadManifestError("manifest_mismatch", "Provider payload does not match the requested provider", "provider");
  }
  if (expected.version !== undefined && expected.version !== manifest.version) {
    throw new ProviderPayloadManifestError("manifest_mismatch", "Provider payload version does not match the requested version", "version");
  }
  if (expected.platform !== undefined && expected.platform !== manifest.platform) {
    throw new ProviderPayloadManifestError("manifest_mismatch", "Provider payload platform does not match the requested platform", "platform");
  }
}

function assertPayloadPath(payloadPath: string): void {
  if (typeof payloadPath !== "string" || payloadPath.length === 0 || /[\u0000-\u001f\u007f]/u.test(payloadPath)) {
    throw new ProviderPayloadManifestError("payload_path_invalid", "A local payload path is required", "payloadPath");
  }
}

/**
 * Verifies a local payload against a strict manifest.  This operation is
 * intentionally read/hash-only: it never fetches, extracts, executes, or
 * installs anything.
 */
export class ProviderPayloadManifestVerifier {
  private readonly readFile: PayloadReadFile;
  private readonly sha256: PayloadSha256;
  private readonly now: () => Date | number | string;
  private readonly allowedSourceHosts?: Partial<Record<ExecutionProvider, readonly string[]>>;

  constructor(options: ProviderPayloadVerifierOptions = {}) {
    this.readFile = options.readFile ?? ((path) => readFileFromDisk(path));
    this.sha256 = options.sha256 ?? defaultSha256;
    this.now = options.now ?? defaultNow;
    this.allowedSourceHosts = options.allowedSourceHosts;
  }

  parse(input: unknown): ProviderPayloadManifest {
    return parseProviderPayloadManifest(input);
  }

  async verify(
    input: unknown,
    payloadPath: string,
    expected?: ProviderPayloadExpectation,
  ): Promise<VerifiedProviderPayload> {
    const manifest = parseProviderPayloadManifest(input);
    validateUsableManifest(manifest, this.now, this.allowedSourceHosts);
    assertExpectation(manifest, expected);
    assertPayloadPath(payloadPath);

    let bytes: Uint8Array;
    try {
      bytes = await this.readFile(payloadPath);
    } catch {
      throw new ProviderPayloadManifestError("payload_read_failed", "Provider payload could not be read");
    }
    if (!(bytes instanceof Uint8Array)) {
      throw new ProviderPayloadManifestError("payload_read_failed", "Provider payload reader did not return bytes");
    }

    let computedSha256: string;
    try {
      computedSha256 = (await this.sha256(bytes)).toLowerCase();
    } catch {
      throw new ProviderPayloadManifestError("payload_hash_failed", "Provider payload hash could not be computed");
    }
    if (!/^[0-9a-f]{64}$/u.test(computedSha256)) {
      throw new ProviderPayloadManifestError("payload_hash_failed", "Provider payload hash seam returned an invalid digest");
    }
    if (computedSha256 !== manifest.sha256) {
      throw new ProviderPayloadManifestError("payload_hash_mismatch", "Provider payload SHA-256 does not match its manifest", "sha256");
    }
    return { manifest, payloadPath, computedSha256 };
  }
}

/** Convenience function for callers that do not need to retain a verifier. */
export function verifyProviderPayloadManifest(
  input: unknown,
  payloadPath: string,
  options: ProviderPayloadVerifierOptions = {},
  expected?: ProviderPayloadExpectation,
): Promise<VerifiedProviderPayload> {
  return new ProviderPayloadManifestVerifier(options).verify(input, payloadPath, expected);
}

/** Short alias for use by the future install wizard. */
export const PayloadManifestVerifier = ProviderPayloadManifestVerifier;
