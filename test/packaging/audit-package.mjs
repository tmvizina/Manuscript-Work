#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listPackage } from "@electron/asar";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const unpacked = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : resolve(root, "dist", "desktop", "win-unpacked");
const asarPath = resolve(unpacked, "resources", "app.asar");
const uiIndex = resolve(unpacked, "resources", "ui", "index.html");
const nativeModule = resolve(unpacked, "resources", "app.asar.unpacked", "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node");
const unpackedModules = resolve(unpacked, "resources", "app.asar.unpacked");
const uiDirectory = resolve(unpacked, "resources", "ui");

for (const required of [asarPath, uiIndex, nativeModule]) {
  if (!existsSync(required) || !statSync(required).isFile()) throw new Error(`Packaged file is missing: ${required}`);
}

const entries = listPackage(asarPath).map((entry) => entry.replaceAll("\\", "/").toLowerCase());
const requiredEntries = [
  "/dist/main/main.js",
  "/dist/main/runtime.js",
  "/dist/preload/index.cjs",
  "/node_modules/@book-writer/core/dist/index.js",
];
for (const expected of requiredEntries) {
  if (!entries.includes(expected)) throw new Error(`Required production entry is missing: ${expected}`);
}

const forbidden = entries.filter((entry) =>
  entry.endsWith(".map") ||
  entry.includes("/fixtures/") ||
  entry.includes("/node_modules/@book-writer/core/src/") ||
  entry.includes("/dist/main/runs/fakerunner.js") ||
  entry.includes("/node_modules/fastify/") ||
  /\/(?:test[^/]*)\.js$/.test(entry) ||
  /\/(?:test|tests)\//.test(entry),
);
if (forbidden.length) throw new Error(`Development files leaked into app.asar:\n${forbidden.join("\n")}`);

function listFiles(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = resolve(directory, entry.name);
    return entry.isDirectory() ? listFiles(absolute, relative) : [relative.toLowerCase()];
  });
}

const looseEntries = [
  ...listFiles(unpackedModules).map((entry) => `app.asar.unpacked/${entry}`),
  ...listFiles(uiDirectory).map((entry) => `ui/${entry}`),
];
const forbiddenLoose = looseEntries.filter((entry) =>
  entry.endsWith(".map") ||
  entry.includes("/fixtures/") ||
  /\/(?:test|tests)\//.test(entry) ||
  /\/(?:test[^/]*)\.(?:js|ts|tsx)$/.test(entry) ||
  entry.includes("/prebuild-install/") ||
  entry.includes("/node-gyp/")
);
if (forbiddenLoose.length) throw new Error(`Development files leaked outside app.asar:\n${forbiddenLoose.join("\n")}`);

console.log(JSON.stringify({
  ok: true,
  workspace: root,
  unpacked,
  asarEntries: entries.length,
  looseEntries: looseEntries.length,
  asarBytes: statSync(asarPath).size,
  nativeModuleBytes: statSync(nativeModule).size,
}));
