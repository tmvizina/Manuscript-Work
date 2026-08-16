#!/usr/bin/env node
/**
 * Exercise the compiled desktop RunManager with a deterministic provider.
 * The mock emits one text event immediately (first-token timing), then a
 * configurable long stream while the manager's replay ring and subscription
 * delivery remain bounded. No provider credentials or network are used.
 */

import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

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
  return `Usage: node test/benchmarks/phase6-stream-benchmark.mjs --repo-root <path> [options]

Options:
  --events <n>       Maximum mock text events (default: 100000)
  --duration-ms <n>  Stop after this wall time; 0 means event-count only
  --interval-ms <n>  Delay between events (default: 0)
`;
}

function positiveInteger(values, name, fallback, { allowZero = false } = {}) {
  const raw = values.get(name);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`--${name} must be a non-negative integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || (!allowZero && value < 1)) throw new Error(`--${name} is out of range`);
  return value;
}

class MockRunHandle {
  constructor(request) {
    this.runId = request.runId;
    this.provider = request.provider;
    this.status = "running";
    this.listeners = new Set();
    this.settled = false;
    this.completion = new Promise((resolvePromise) => {
      this.resolveCompletion = resolvePromise;
    });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of [...this.listeners]) listener(event);
  }

  complete(resultText) {
    if (this.settled) return;
    this.settled = true;
    this.status = "completed";
    this.resolveCompletion({
      runId: this.runId,
      provider: this.provider,
      status: "completed",
      resultText,
    });
  }

  async cancel() {
    this.complete("cancelled");
    this.status = "cancelled";
    return true;
  }

  wait() {
    return this.completion;
  }
}

class MockRunner {
  constructor() {
    this.handleValue = null;
  }

  start(request) {
    this.handleValue = new MockRunHandle(request);
    return this.handleValue;
  }

  get handle() {
    if (!this.handleValue) throw new Error("The mock provider has not started");
    return this.handleValue;
  }
}

function memorySnapshot() {
  const memory = process.memoryUsage();
  return { heapUsedBytes: memory.heapUsed, rssBytes: memory.rss };
}

async function main() {
  const values = parseArgs(process.argv.slice(2));
  if (values.get("help")) {
    process.stdout.write(usage());
    return;
  }
  const repoRoot = resolve(values.get("repo-root") ?? ".");
  const managerEntry = resolve(repoRoot, "app/desktop/dist/main/runs/manager.js");
  if (!existsSync(managerEntry)) throw new Error("Compiled desktop RunManager is missing; run npm.cmd run build first");
  const eventsTarget = positiveInteger(values, "events", 100000);
  const durationMs = positiveInteger(values, "duration-ms", 10000, { allowZero: true });
  const intervalMs = positiveInteger(values, "interval-ms", 0, { allowZero: true });
  const { InMemoryRunPersistence, RunManager } = await import(pathToFileURL(managerEntry).href);

  const runner = new MockRunner();
  const persistence = new InMemoryRunPersistence();
  const replayLimit = 1000;
  const manager = new RunManager({
    runner,
    persistence,
    replayLimit,
    idFactory: (() => {
      let run = 0;
      let subscription = 0;
      return (kind) => kind === "run" ? `phase6-run-${++run}` : `phase6-sub-${++subscription}`;
    })(),
  });

  if (typeof global.gc === "function") global.gc();
  const beforeMemory = memorySnapshot();
  const start = performance.now();
  const accepted = await manager.startRun({ provider: "codex", prompt: "phase 6 synthetic stream", variant: "base" });
  let firstTokenMs = null;
  let deliveries = 0;
  await manager.subscribeRun({ runId: accepted.runId, afterSequence: -1 }, ({ event }) => {
    deliveries += 1;
    if (firstTokenMs === null && event.type === "text_delta") firstTokenMs = performance.now() - start;
  });

  runner.handle.emit({ type: "text_delta", role: "assistant", text: "first synthetic token" });
  let emitted = 1;
  const streamStart = performance.now();
  let peakMemory = memorySnapshot();
  const sampleEvery = Math.max(1, Math.floor(eventsTarget / 100));
  while (emitted < eventsTarget && (durationMs === 0 || performance.now() - streamStart < durationMs)) {
    runner.handle.emit({ type: "text_delta", role: "assistant", text: "synthetic token payload" });
    emitted += 1;
    if (emitted % sampleEvery === 0) {
      const sample = memorySnapshot();
      if (sample.heapUsedBytes > peakMemory.heapUsedBytes) peakMemory = sample;
      if (sample.rssBytes > peakMemory.rssBytes) peakMemory = { ...peakMemory, rssBytes: sample.rssBytes };
    }
    if (intervalMs > 0) await sleep(intervalMs);
  }
  runner.handle.complete("synthetic stream complete");
  await runner.handle.wait();
  await Promise.resolve();
  await Promise.resolve();
  const replay = await manager.subscribeRun({ runId: accepted.runId, afterSequence: -1 }, () => undefined);
  if (typeof global.gc === "function") global.gc();
  const afterMemory = memorySnapshot();
  await manager.shutdown();

  process.stdout.write(`${JSON.stringify({
    provider: "mock-codex",
    eventsRequested: eventsTarget,
    eventsEmitted: emitted,
    durationMs: Number((performance.now() - streamStart).toFixed(3)),
    intervalMs,
    firstTokenMs: firstTokenMs === null ? null : Number(firstTokenMs.toFixed(3)),
    deliveries,
    replayLimit,
    replayLength: replay.replay.length,
    replayTruncated: replay.replayTruncated,
    boundedReplay: replay.replay.length <= replayLimit,
    heapBeforeBytes: beforeMemory.heapUsedBytes,
    heapAfterBytes: afterMemory.heapUsedBytes,
    peakHeapBytes: peakMemory.heapUsedBytes,
    rssBeforeBytes: beforeMemory.rssBytes,
    rssAfterBytes: afterMemory.rssBytes,
    peakRssBytes: peakMemory.rssBytes,
    heapDeltaBytes: afterMemory.heapUsedBytes - beforeMemory.heapUsedBytes,
    rssDeltaBytes: afterMemory.rssBytes - beforeMemory.rssBytes,
    note: "Bounded RunManager replay and delivery were measured; renderer task duration and a real provider process were not exercised.",
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
