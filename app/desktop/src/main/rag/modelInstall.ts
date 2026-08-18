import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseRagModelManifest, RAG_MODEL_DIRECTORY_NAME, RAG_MODEL_MANIFEST_FILE_NAME } from "./modelManifest.js";

export type RagModelInstallStatus = "installed" | "already_installed" | "cancelled" | "rejected";

export interface RagModelInstallResult {
  status: RagModelInstallStatus;
  /** Non-secret reason shown to the user when the file was refused. */
  message: string;
}

export interface RagModelInstallOptions {
  /** Packaged resources directory, source of the trusted manifest. */
  resourcesPath: string;
  /** Writable root for imported weights, below Electron userData. */
  userDataModelDir: string;
  /** Returns the chosen file, or null when the user cancelled. */
  pickFile: () => Promise<string | null>;
}

/**
 * Install the model weights that ship alongside the installer rather than
 * inside it.
 *
 * The weights are the only part large enough to push the installer past
 * GitHub's 100 MB file limit, so a build can carry the manifest, tokenizer,
 * and licence while the weights arrive as a separate file.
 *
 * The file is verified against the manifest already inside the application,
 * never against anything supplied with the file itself. That is the whole
 * security property here: a chosen file is untrusted input, and accepting a
 * manifest that travelled with it would let any file describe itself as
 * correct.
 */
export async function installRagModelWeights(options: RagModelInstallOptions): Promise<RagModelInstallResult> {
  const manifestPath = join(resolve(options.resourcesPath), RAG_MODEL_DIRECTORY_NAME, RAG_MODEL_MANIFEST_FILE_NAME);
  const manifest = parseRagModelManifest(readFileSync(manifestPath, "utf-8"));
  const expected = manifest.files.find((file) => file.role === "model");
  if (!expected) return { status: "rejected", message: "This build does not describe a model file." };

  const target = join(resolve(options.userDataModelDir), expected.fileName);
  if (isAlreadyValid(target, expected.sizeBytes, expected.sha256)) {
    return { status: "already_installed", message: "Semantic search is already installed." };
  }

  const chosen = await options.pickFile();
  if (!chosen) return { status: "cancelled", message: "No file was selected." };

  const source = resolve(chosen);
  if (basename(source).toLowerCase() !== expected.fileName.toLowerCase()) {
    return { status: "rejected", message: `Expected a file named ${expected.fileName}.` };
  }

  let size: number;
  try {
    size = statSync(source).size;
  } catch {
    return { status: "rejected", message: "That file could not be read." };
  }
  if (size !== expected.sizeBytes) {
    return { status: "rejected", message: `That file is ${size} bytes; this build expects ${expected.sizeBytes}.` };
  }

  let digest: string;
  try {
    digest = createHash("sha256").update(readFileSync(source)).digest("hex");
  } catch {
    return { status: "rejected", message: "That file could not be read." };
  }
  if (digest !== expected.sha256) {
    return { status: "rejected", message: "That file does not match the model this build expects." };
  }

  // Publish atomically: a copy interrupted partway must not leave a truncated
  // file where the loader would later find it and trust its presence.
  mkdirSync(resolve(options.userDataModelDir), { recursive: true });
  const staging = `${target}.partial`;
  rmSync(staging, { force: true });
  try {
    copyFileSync(source, staging);
    renameSync(staging, target);
  } catch (error) {
    rmSync(staging, { force: true });
    return { status: "rejected", message: `The model could not be installed: ${error instanceof Error ? error.message : String(error)}` };
  }

  return { status: "installed", message: "Semantic search is ready." };
}

function isAlreadyValid(path: string, sizeBytes: number, sha256: string): boolean {
  try {
    if (statSync(path).size !== sizeBytes) return false;
    return createHash("sha256").update(readFileSync(path)).digest("hex") === sha256;
  } catch {
    return false;
  }
}
