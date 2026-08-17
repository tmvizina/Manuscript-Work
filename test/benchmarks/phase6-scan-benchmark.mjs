#!/usr/bin/env node
/**
 * Run the real compiled chapter scanner twice against one fixture. The first
 * pass populates a temporary SQLite snapshot; the second pass exercises the
 * unchanged-file path and reports how many chapters were skipped by hash.
 *
 * This helper deliberately requires a built workspace. A benchmark must not
 * silently replace the production scanner with a look-alike implementation.
 */

import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      values.set("help", true);
      continue;
    }
    if (!argument.startsWith("--")) throw new Error(`Unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    values.set(argument.slice(2), value);
    index += 1;
  }
  return values;
}

function usage() {
  return `Usage: node test/benchmarks/phase6-scan-benchmark.mjs --repo-root <path> --project <path> --db <path>

The project path is a manuscript root containing chapters/ (and optionally
book-2/chapters/ or prequel-novella/chapters/). The database path must be a
temporary path owned by the caller.
`;
}

function required(values, name) {
  const value = values.get(name);
  if (!value) throw new Error(`--${name} is required`);
  return resolve(value);
}

async function main() {
  const values = parseArgs(process.argv.slice(2));
  if (values.get("help")) {
    process.stdout.write(usage());
    return;
  }

  const repoRoot = required(values, "repo-root");
  const projectRoot = required(values, "project");
  const databasePath = required(values, "db");
  const projectChaptersEntry = resolve(repoRoot, "packages/core/dist/content/projectChapters.js");
  const databaseEntry = resolve(repoRoot, "packages/core/dist/db/index.js");
  if (!existsSync(projectChaptersEntry) || !existsSync(databaseEntry)) {
    throw new Error("Compiled core entries are missing; run npm.cmd run build first");
  }
  if (!existsSync(projectRoot)) throw new Error(`Project root does not exist: ${projectRoot}`);

  const { syncProjectChapters } = await import(pathToFileURL(projectChaptersEntry).href);
  const { createProject, openDb } = await import(pathToFileURL(databaseEntry).href);
  const database = openDb(databasePath);
  const project = { projectId: "phase6-benchmark", rootPath: projectRoot };
  createProject(database, { ...project, name: "Phase 6 benchmark" });
  let first;
  let second;
  const firstStart = performance.now();
  try {
    first = syncProjectChapters(database, project);
  } finally {
    const firstEnd = performance.now();
    const secondStart = firstEnd;
    try {
      second = syncProjectChapters(database, project);
    } finally {
      const secondEnd = performance.now();
      database.close();
      process.stdout.write(`${JSON.stringify({
        project: projectRoot,
        database: databasePath,
        firstScanMs: Number((firstEnd - firstStart).toFixed(3)),
        unchangedScanMs: Number((secondEnd - secondStart).toFixed(3)),
        first,
        second,
      })}\n`);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
