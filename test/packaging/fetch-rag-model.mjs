#!/usr/bin/env node
// Fetch the embedding model into app/desktop/resources/rag-model/ so the
// packaged installer can carry it.
//
// The model is deliberately NOT committed: a ~23 MB binary would live in git
// history on every clone forever. It is fetched at build time and verified
// against the checked-in manifest.json, so the bytes are pinned even though
// they are not versioned. Only the machine producing an installer needs
// network access; the installed app never fetches anything.
//
// Fails closed. A hash or size mismatch aborts the build rather than shipping
// an unverified artifact, and a partial download is never published under the
// real filename.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const modelDir = join(root, "app", "desktop", "resources", "rag-model");
const manifestPath = join(modelDir, "manifest.json");

if (!existsSync(manifestPath)) {
  throw new Error(`Model manifest is missing: ${manifestPath}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
  throw new Error("Model manifest lists no files.");
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A file already on disk counts only if it matches the manifest exactly. */
function isAlreadyValid(entry, destination) {
  if (!existsSync(destination)) return false;
  if (statSync(destination).size !== entry.sizeBytes) return false;
  return sha256(readFileSync(destination)) === entry.sha256;
}

async function download(entry, destination) {
  const response = await fetch(entry.sourceUrl, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Download failed for ${entry.fileName}: HTTP ${response.status} ${response.statusText}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());

  if (bytes.length !== entry.sizeBytes) {
    throw new Error(
      `Size mismatch for ${entry.fileName}: expected ${entry.sizeBytes} bytes, received ${bytes.length}. ` +
        `Refusing to publish an unverified artifact.`,
    );
  }
  const actual = sha256(bytes);
  if (actual !== entry.sha256) {
    throw new Error(
      `SHA-256 mismatch for ${entry.fileName}:\n  expected ${entry.sha256}\n  actual   ${actual}\n` +
        `The upstream artifact changed or the download was tampered with. Refusing to publish it.`,
    );
  }

  // Publish atomically: a crash mid-write must not leave a truncated file
  // sitting under the real name, where the next run's size/hash check would be
  // the only thing standing between it and a shipped installer.
  const temporary = `${destination}.partial`;
  writeFileSync(temporary, bytes);
  renameSync(temporary, destination);
}

mkdirSync(modelDir, { recursive: true });

let downloaded = 0;
let reused = 0;
for (const entry of manifest.files) {
  if (typeof entry.fileName !== "string" || entry.fileName.includes("/") || entry.fileName.includes("\\")) {
    throw new Error(`Manifest file name is not a plain file name: ${String(entry.fileName)}`);
  }
  const destination = join(modelDir, entry.fileName);
  if (isAlreadyValid(entry, destination)) {
    reused += 1;
    continue;
  }
  rmSync(`${destination}.partial`, { force: true });
  process.stdout.write(`fetching ${entry.fileName} (${entry.sizeBytes} bytes)...\n`);
  await download(entry, destination);
  downloaded += 1;
}

console.log(
  JSON.stringify(
    {
      ok: true,
      modelId: manifest.modelId,
      license: manifest.license,
      modelDir,
      downloaded,
      reused,
      files: manifest.files.map((entry) => ({ fileName: entry.fileName, sizeBytes: entry.sizeBytes })),
    },
    null,
    2,
  ),
);
