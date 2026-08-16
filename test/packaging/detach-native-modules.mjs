#!/usr/bin/env node
import { copyFileSync, existsSync, renameSync, statSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const unpacked = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : resolve(root, "dist", "desktop", "win-unpacked");
const nativeModule = resolve(
  unpacked,
  "resources",
  "app.asar.unpacked",
  "node_modules",
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node",
);

if (!nativeModule.startsWith(resolve(root, "dist", "desktop"))) {
  throw new Error(`Refusing to detach a native module outside dist/desktop: ${nativeModule}`);
}
if (!existsSync(nativeModule) || !statSync(nativeModule).isFile()) {
  throw new Error(`Packaged native module is missing: ${nativeModule}`);
}

const temporary = `${nativeModule}.detach-${randomUUID().replaceAll("-", "")}`;
let moved = false;
try {
  renameSync(nativeModule, temporary);
  moved = true;
  copyFileSync(temporary, nativeModule);
  unlinkSync(temporary);
  moved = false;
  console.log(JSON.stringify({ ok: true, detached: nativeModule, bytes: statSync(nativeModule).size }));
} finally {
  if (moved && !existsSync(nativeModule) && existsSync(temporary)) renameSync(temporary, nativeModule);
}
