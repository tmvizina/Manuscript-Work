import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Verified, offline-only delivery of the bundled RAG embedding model.
 *
 * Mirrors `../providers/payloadManifest.ts`'s verification discipline (strict
 * key checking, bounded string fields, SHA-256 verify-before-load, fail
 * closed on any mismatch) for the one first-party, pre-approved artifact
 * this app ships: `Xenova/all-MiniLM-L6-v2` (Apache-2.0). Unlike the
 * Claude/Codex provider payloads, this artifact needs no per-release
 * `approval` record — Apache-2.0 is unambiguous and pre-cleared by its own
 * terms — but the same "never trust bytes on disk without a hash check"
 * rule applies.
 *
 * The model's actual binary/tokenizer bytes are NEVER committed to this
 * repository (see `test/packaging/fetch-rag-model.mjs`, which fetches and
 * verifies them at release-build time into a gitignored directory). This
 * module's `manifest.json` sibling file — small, text-only — IS checked in;
 * it is "the checked-in manifest" this verifier reads and trusts only after
 * hashing every referenced file.
 */

export const RAG_MODEL_SCHEMA_VERSION = 1 as const;
export type RagModelSchemaVersion = typeof RAG_MODEL_SCHEMA_VERSION;

/** Name of the extraResources directory this model ships in. */
export const RAG_MODEL_DIRECTORY_NAME = "rag-model";
/** Name of the checked-in manifest file inside that directory. */
export const RAG_MODEL_MANIFEST_FILE_NAME = "manifest.json";
export const RAG_MODEL_LICENSE_FILE_NAME = "LICENSE";
export const RAG_MODEL_NOTICE_FILE_NAME = "NOTICE";

export type RagModelFileRole = "model" | "tokenizer";

/** The exact set of files this app ever expects to load — nothing else. */
const REQUIRED_FILES: ReadonlyArray<{ fileName: string; role: RagModelFileRole }> = [
  { fileName: "model_quantized.onnx", role: "model" },
  { fileName: "tokenizer.json", role: "tokenizer" },
  { fileName: "tokenizer_config.json", role: "tokenizer" },
  { fileName: "config.json", role: "tokenizer" },
];
const REQUIRED_FILE_NAMES = REQUIRED_FILES.map((entry) => entry.fileName).sort();

export interface RagModelFileEntry {
  fileName: string;
  role: RagModelFileRole;
  sourceUrl: string;
  sha256: string;
  sizeBytes: number;
}

export interface RagModelManifest {
  schemaVersion: RagModelSchemaVersion;
  modelId: string;
  upstreamModelId: string;
  license: string;
  publisher: string;
  embeddingDim: number;
  quantization: string;
  files: RagModelFileEntry[];
}

/**
 * The contract required by the concurrent embedder work
 * (`app/desktop/src/main/rag/embedder.ts` and friends). Do not change this
 * shape without updating that owner's code too.
 */
export interface VerifiedRagModel {
  /** Absolute path to the verified .onnx model file. */
  modelPath: string;
  /** Absolute directory containing tokenizer.json etc. */
  tokenizerDir: string;
  /** e.g. "Xenova/all-MiniLM-L6-v2" */
  modelId: string;
  /** The verified hash, meant to be stored on every chunk row. */
  modelSha256: string;
  embeddingDim: number;
}

export type RagModelManifestErrorCode =
  | "manifest_missing"
  | "manifest_read_failed"
  | "manifest_parse_failed"
  | "manifest_not_object"
  | "manifest_unknown_key"
  | "manifest_missing_field"
  | "manifest_field_invalid"
  | "manifest_file_set_invalid"
  | "file_missing"
  | "file_read_failed"
  | "file_size_mismatch"
  | "file_hash_mismatch"
  | "file_hash_failed"
  | "license_missing"
  | "notice_missing";

/** A stable, non-secret error from manifest parsing or local verification. */
export class RagModelManifestError extends Error {
  readonly code: RagModelManifestErrorCode;
  readonly field?: string;

  constructor(code: RagModelManifestErrorCode, message: string, field?: string) {
    super(message);
    this.name = "RagModelManifestError";
    this.code = code;
    this.field = field;
  }
}

export type RagModelReadFile = (path: string) => Buffer | Uint8Array;
export type RagModelStatSize = (path: string) => number;
export type RagModelSha256 = (bytes: Uint8Array) => string;
export type RagModelExists = (path: string) => boolean;

export interface RagModelVerifierOptions {
  /** Injected in tests; defaults to a real synchronous filesystem read. */
  readFile?: RagModelReadFile;
  /** Injected in tests; defaults to a real synchronous `stat().size`. */
  statSize?: RagModelStatSize;
  /** Injected hash implementation, kept separate from filesystem access. */
  sha256?: RagModelSha256;
  /** Injected existence check, used for the LICENSE/NOTICE presence gate. */
  exists?: RagModelExists;
  /**
   * Extra directories to look in for a manifest file that is not beside the
   * manifest itself. The weights exceed GitHub's file limit inside an
   * installer, so a build may ship the manifest, tokenizer, and licence while
   * the model file is imported later into app data. A file found here is
   * hash-checked against the same manifest, so its origin changes where it is
   * read from and nothing about whether it is trusted.
   */
  fallbackRoots?: readonly string[];
}

const MANIFEST_KEYS = [
  "embeddingDim",
  "files",
  "license",
  "modelId",
  "publisher",
  "quantization",
  "schemaVersion",
  "upstreamModelId",
].sort();

const FILE_ENTRY_KEYS = ["fileName", "role", "sha256", "sizeBytes", "sourceUrl"].sort();

const MAX_ID_LENGTH = 256;
const MAX_LICENSE_LENGTH = 128;
const MAX_PUBLISHER_LENGTH = 512;
const MAX_QUANTIZATION_LENGTH = 512;
const MAX_SOURCE_URL_LENGTH = 2_048;
const MIN_EMBEDDING_DIM = 1;
const MAX_EMBEDDING_DIM = 8_192;
const MAX_FILE_SIZE_BYTES = 512 * 1024 * 1024; // generous ceiling; catches corrupt metadata, not a real limit

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
      throw new RagModelManifestError("manifest_unknown_key", `${path} contains an unsupported field`, `${path}.${unexpected}`);
    }
    const missing = expected.find((key) => !actual.includes(key));
    throw new RagModelManifestError("manifest_missing_field", `${path} is missing a required field`, `${path}.${missing ?? "unknown"}`);
  }
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || /[\u0000-\u001F]/u.test(value)) {
    throw new RagModelManifestError("manifest_field_invalid", `${field} must be a bounded text value`, field);
  }
  return value;
}

function validateSourceUrl(value: unknown, field: string): string {
  const sourceUrl = requiredString(value, field, MAX_SOURCE_URL_LENGTH);
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new RagModelManifestError("manifest_field_invalid", `${field} must be a valid HTTPS URL`, field);
  }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password || parsed.hash) {
    throw new RagModelManifestError("manifest_field_invalid", `${field} must be a credential-free HTTPS URL`, field);
  }
  return parsed.toString();
}

function validateSha256(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/iu.test(value)) {
    throw new RagModelManifestError("manifest_field_invalid", `${field} must be a 64-character hexadecimal digest`, field);
  }
  return value.toLowerCase();
}

function validateSizeBytes(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > MAX_FILE_SIZE_BYTES) {
    throw new RagModelManifestError("manifest_field_invalid", `${field} must be a positive integer byte count`, field);
  }
  return value;
}

function validateFileEntry(value: unknown, index: number): RagModelFileEntry {
  const path = `files[${index}]`;
  if (!isRecord(value)) {
    throw new RagModelManifestError("manifest_field_invalid", `${path} must be an object`, path);
  }
  hasExactKeys(value, FILE_ENTRY_KEYS, path);
  const fileName = requiredString(value.fileName, `${path}.fileName`, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(fileName)) {
    throw new RagModelManifestError("manifest_field_invalid", `${path}.fileName contains unsupported characters`, `${path}.fileName`);
  }
  if (value.role !== "model" && value.role !== "tokenizer") {
    throw new RagModelManifestError("manifest_field_invalid", `${path}.role must be "model" or "tokenizer"`, `${path}.role`);
  }
  return {
    fileName,
    role: value.role,
    sourceUrl: validateSourceUrl(value.sourceUrl, `${path}.sourceUrl`),
    sha256: validateSha256(value.sha256, `${path}.sha256`),
    sizeBytes: validateSizeBytes(value.sizeBytes, `${path}.sizeBytes`),
  };
}

function validateFileSet(files: RagModelFileEntry[]): void {
  const names = files.map((entry) => entry.fileName).sort();
  const duplicate = names.find((name, index) => names[index - 1] === name);
  if (duplicate) {
    throw new RagModelManifestError("manifest_file_set_invalid", `manifest.files lists "${duplicate}" more than once`, "files");
  }
  if (names.length !== REQUIRED_FILE_NAMES.length || names.some((name, index) => name !== REQUIRED_FILE_NAMES[index])) {
    throw new RagModelManifestError(
      "manifest_file_set_invalid",
      `manifest.files must list exactly: ${REQUIRED_FILE_NAMES.join(", ")}`,
      "files",
    );
  }
  for (const required of REQUIRED_FILES) {
    const entry = files.find((file) => file.fileName === required.fileName);
    if (entry && entry.role !== required.role) {
      throw new RagModelManifestError(
        "manifest_file_set_invalid",
        `manifest file "${required.fileName}" must have role "${required.role}"`,
        "files",
      );
    }
  }
}

function validateManifestValue(value: unknown): RagModelManifest {
  if (!isRecord(value)) {
    throw new RagModelManifestError("manifest_not_object", "RAG model manifest must be an object");
  }
  hasExactKeys(value, MANIFEST_KEYS, "manifest");
  if (value.schemaVersion !== RAG_MODEL_SCHEMA_VERSION) {
    throw new RagModelManifestError("manifest_field_invalid", "Unsupported RAG model manifest schema", "schemaVersion");
  }
  const modelId = requiredString(value.modelId, "modelId", MAX_ID_LENGTH);
  const upstreamModelId = requiredString(value.upstreamModelId, "upstreamModelId", MAX_ID_LENGTH);
  const license = requiredString(value.license, "license", MAX_LICENSE_LENGTH);
  const publisher = requiredString(value.publisher, "publisher", MAX_PUBLISHER_LENGTH);
  const quantization = requiredString(value.quantization, "quantization", MAX_QUANTIZATION_LENGTH);
  if (
    typeof value.embeddingDim !== "number" ||
    !Number.isInteger(value.embeddingDim) ||
    value.embeddingDim < MIN_EMBEDDING_DIM ||
    value.embeddingDim > MAX_EMBEDDING_DIM
  ) {
    throw new RagModelManifestError("manifest_field_invalid", "embeddingDim must be a positive integer", "embeddingDim");
  }
  if (!Array.isArray(value.files)) {
    throw new RagModelManifestError("manifest_field_invalid", "files must be an array", "files");
  }
  const files = value.files.map((entry, index) => validateFileEntry(entry, index));
  validateFileSet(files);
  return {
    schemaVersion: RAG_MODEL_SCHEMA_VERSION,
    modelId,
    upstreamModelId,
    license,
    publisher,
    embeddingDim: value.embeddingDim,
    quantization,
    files,
  };
}

/** Parse and strictly validate a checked-in manifest; no filesystem access occurs. */
export function parseRagModelManifest(input: unknown): RagModelManifest {
  if (typeof input === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input) as unknown;
    } catch {
      throw new RagModelManifestError("manifest_parse_failed", "RAG model manifest is not valid JSON");
    }
    return validateManifestValue(parsed);
  }
  return validateManifestValue(input);
}

function defaultSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function nodeErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : undefined;
}

/**
 * Verifies bundled model bytes against a manifest, given full control over
 * where the manifest and model directory live. `resolveVerifiedRagModel`
 * below is the production entry point that reads `manifest.json` from disk;
 * this function exists so tests can exercise every failure path against
 * small fixture files instead of the real ~23 MB model.
 */
export function verifyRagModelDirectory(
  modelDir: string,
  options: RagModelVerifierOptions = {},
): VerifiedRagModel {
  const readFile = options.readFile ?? ((path: string) => readFileSync(path));
  const statSize = options.statSize ?? ((path: string) => statSync(path).size);
  const sha256 = options.sha256 ?? defaultSha256;
  const exists = options.exists ?? ((path: string) => {
    try {
      statSync(path);
      return true;
    } catch {
      return false;
    }
  });

  const manifestPath = join(modelDir, RAG_MODEL_MANIFEST_FILE_NAME);
  let manifestBytes: Buffer | Uint8Array;
  try {
    manifestBytes = readFile(manifestPath);
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") {
      throw new RagModelManifestError("manifest_missing", `RAG model manifest is missing: ${manifestPath}`);
    }
    throw new RagModelManifestError("manifest_read_failed", `RAG model manifest could not be read: ${manifestPath}`);
  }

  const manifestText = Buffer.isBuffer(manifestBytes) ? manifestBytes.toString("utf8") : Buffer.from(manifestBytes).toString("utf8");
  const manifest = parseRagModelManifest(manifestText);

  const modelEntry = manifest.files.find((entry) => entry.role === "model");
  if (!modelEntry) {
    // Unreachable given validateFileSet's exact-set check, but keeps this
    // function's failure mode explicit rather than a thrown TypeError.
    throw new RagModelManifestError("manifest_file_set_invalid", "manifest.files has no model-role entry", "files");
  }

  const resolvedPaths = new Map<string, string>();

  for (const entry of manifest.files) {
    const candidates = [join(modelDir, entry.fileName), ...(options.fallbackRoots ?? []).map((root) => join(root, entry.fileName))];
    const filePath = candidates.find((candidate) => exists(candidate)) ?? candidates[0];
    resolvedPaths.set(entry.fileName, filePath);

    let actualSize: number;
    try {
      actualSize = statSize(filePath);
    } catch (error) {
      if (nodeErrorCode(error) === "ENOENT") {
        throw new RagModelManifestError("file_missing", `RAG model file is missing: ${filePath}`, entry.fileName);
      }
      throw new RagModelManifestError("file_read_failed", `RAG model file could not be read: ${filePath}`, entry.fileName);
    }
    if (actualSize !== entry.sizeBytes) {
      throw new RagModelManifestError(
        "file_size_mismatch",
        `RAG model file "${entry.fileName}" is ${actualSize} bytes, expected ${entry.sizeBytes}`,
        entry.fileName,
      );
    }

    let bytes: Buffer | Uint8Array;
    try {
      bytes = readFile(filePath);
    } catch {
      throw new RagModelManifestError("file_read_failed", `RAG model file could not be read: ${filePath}`, entry.fileName);
    }

    let computedSha256: string;
    try {
      computedSha256 = sha256(bytes).toLowerCase();
    } catch {
      throw new RagModelManifestError("file_hash_failed", `RAG model file hash could not be computed: ${filePath}`, entry.fileName);
    }
    if (!/^[0-9a-f]{64}$/u.test(computedSha256)) {
      throw new RagModelManifestError("file_hash_failed", `RAG model hash seam returned an invalid digest for: ${filePath}`, entry.fileName);
    }
    if (computedSha256 !== entry.sha256) {
      throw new RagModelManifestError(
        "file_hash_mismatch",
        `RAG model file "${entry.fileName}" SHA-256 does not match the manifest`,
        entry.fileName,
      );
    }
  }

  // Apache-2.0 Section 4: the license text and modification notice must
  // travel with a redistributed artifact. Their absence is a packaging bug,
  // not a soft warning — fail closed the same as a hashed file would.
  const licensePath = join(modelDir, RAG_MODEL_LICENSE_FILE_NAME);
  if (!exists(licensePath) || statSize(licensePath) === 0) {
    throw new RagModelManifestError("license_missing", `RAG model LICENSE is missing or empty: ${licensePath}`);
  }
  const noticePath = join(modelDir, RAG_MODEL_NOTICE_FILE_NAME);
  if (!exists(noticePath) || statSize(noticePath) === 0) {
    throw new RagModelManifestError("notice_missing", `RAG model NOTICE is missing or empty: ${noticePath}`);
  }

  return {
    modelPath: resolvedPaths.get(modelEntry.fileName) ?? join(modelDir, modelEntry.fileName),
    tokenizerDir: modelDir,
    modelId: manifest.modelId,
    modelSha256: modelEntry.sha256,
    embeddingDim: manifest.embeddingDim,
  };
}

/**
 * Verifies bundled model bytes against the checked-in manifest. Throws on
 * any mismatch.
 *
 * `resourcesPath` is the packaged app's resources directory
 * (`process.resourcesPath` when packaged; a development-mode equivalent
 * otherwise). electron-builder's `extraResources` entry ships this model at
 * `<resourcesPath>/rag-model/`.
 */
export function resolveVerifiedRagModel(resourcesPath: string, options: RagModelVerifierOptions = {}): VerifiedRagModel {
  const modelDir = join(resourcesPath, RAG_MODEL_DIRECTORY_NAME);
  return verifyRagModelDirectory(modelDir, options);
}
