import { describe, expect, it } from "vitest";
import {
  DeterministicFakeRunner,
  InMemoryRunPersistence,
  RunManager,
  type RunManagerOptions,
} from "./index.js";
import { RUN_REPLAY_LIMIT, type RunEvent, type RunRequest } from "../../shared/contracts.js";

const request: RunRequest = { provider: "codex", prompt: "test prompt", variant: "base" };

function harness(replayLimit = RUN_REPLAY_LIMIT) {
  const runner = new DeterministicFakeRunner();
  const persistence = new InMemoryRunPersistence();
  const options: RunManagerOptions = {
    runner,
    persistence,
    replayLimit,
    idFactory: (() => {
      let run = 0;
      let subscription = 0;
      return (kind) => kind === "run" ? `run-${++run}` : `subscription-${++subscription}`;
    })(),
    clock: (() => {
      let tick = 0;
      return () => `2026-08-16T00:00:${String(++tick).padStart(2, "0")}Z`;
    })(),
  };
  return { manager: new RunManager(options), persistence, runner };
}

async function start(test: ReturnType<typeof harness>) {
  return test.manager.startRun(request);
}

describe("RunManager", () => {
  it("installs live forwarding before replay and avoids overlap duplicates", async () => {
    const test = harness();
    const accepted = await start(test);
    const handle = test.runner.handle(accepted.runId);
    handle.emit({ type: "text_delta", role: "assistant", text: "early" });

    const live: RunEvent[] = [];
    const subscription = await test.manager.subscribeRun(
      { runId: accepted.runId, afterSequence: -1 },
      (delivery) => live.push(delivery.event),
    );
    handle.emit({ type: "text_delta", role: "assistant", text: "late" });

    expect(subscription.replay.map((event) => event.text)).toEqual(["early"]);
    expect(live.map((event) => event.text)).toEqual(["late"]);
    expect(new Set([...subscription.replay, ...live].map((event) => event.sequence)).size).toBe(2);
  });

  it("truncates replay to its bounded limit and reports a stale cursor", async () => {
    const test = harness(3);
    const accepted = await start(test);
    const handle = test.runner.handle(accepted.runId);
    for (let index = 0; index < 5; index += 1) handle.emit({ type: "text_delta", role: "assistant", text: String(index) });

    const replay = await test.manager.subscribeRun({ runId: accepted.runId, afterSequence: -1 }, () => undefined);
    expect(replay.replay.map((event) => event.text)).toEqual(["2", "3", "4"]);
    expect(replay.replayTruncated).toBe(true);
    expect(replay.replayCursor).toBe(4);

    const current = await test.manager.subscribeRun({ runId: accepted.runId, afterSequence: 3 }, () => undefined);
    expect(current.replay.map((event) => event.text)).toEqual(["4"]);
    expect(current.replayTruncated).toBe(false);
  });

  it("only cancels the owned active handle", async () => {
    const test = harness();
    const first = await start(test);
    const second = await start(test);
    expect(await test.manager.cancelRun(first.runId)).toEqual({ runId: first.runId, cancelled: true });
    expect(test.runner.handle(first.runId).cancelCalls).toBe(1);
    expect(test.runner.handle(second.runId).cancelCalls).toBe(0);
    expect(await test.manager.cancelRun(first.runId)).toEqual({ runId: first.runId, cancelled: false });
    expect((await test.manager.getRun(first.runId)).status).toBe("cancelled");
  });

  it("persists completion and emits a terminal event when the provider emits none", async () => {
    const test = harness();
    const accepted = await start(test);
    const events: RunEvent[] = [];
    await test.manager.subscribeRun({ runId: accepted.runId }, ({ event }) => events.push(event));
    test.runner.complete(accepted.runId, { resultText: "done", usage: { outputTokens: 7 } });
    await Promise.resolve();
    await Promise.resolve();
    expect((await test.manager.getRun(accepted.runId)).status).toBe("completed");
    expect(events.at(-1)).toMatchObject({ type: "run_completed", result: "done" });
  });

  it("persists provider failure and removes its active ownership", async () => {
    const test = harness();
    const accepted = await start(test);
    const events: RunEvent[] = [];
    await test.manager.subscribeRun({ runId: accepted.runId }, ({ event }) => events.push(event));
    test.runner.fail(accepted.runId, { code: "E_PROVIDER", message: "nope", cause: { secret: true } });
    await Promise.resolve();
    await Promise.resolve();
    expect((await test.manager.getRun(accepted.runId)).status).toBe("failed");
    expect((await test.manager.getRun(accepted.runId)).error).toBe("nope");
    expect(events.at(-1)).toMatchObject({ type: "run_failed", error: { code: "E_PROVIDER", message: "nope" } });
    expect(events.at(-1)).not.toHaveProperty("cause");
  });

  it("sanitizes raw, cause, private metadata, and provider-owned sequence fields", async () => {
    const test = harness();
    const accepted = await start(test);
    const received: RunEvent[] = [];
    await test.manager.subscribeRun({ runId: accepted.runId }, ({ event }) => received.push(event));
    test.runner.emit(accepted.runId, {
      type: "tool_call",
      sequence: 999999,
      line: 42,
      raw: { token: "secret" },
      cause: new Error("private"),
      metadata: { internal: "private" },
      toolCallId: "tool-1",
      name: "Read",
      input: { path: "chapter.txt", metadata: { private: true }, raw: "hidden" },
      command: "cat chapter.txt",
    });
    const event = received[0]!;
    expect(event).toEqual({
      runId: accepted.runId,
      provider: "codex",
      sequence: 0,
      type: "tool_call",
      toolCallId: "tool-1",
      name: "Read",
      input: { path: "chapter.txt" },
    });
    expect(event).not.toHaveProperty("raw");
    expect(event).not.toHaveProperty("cause");
    expect(event).not.toHaveProperty("metadata");

    test.runner.emit(accepted.runId, {
      type: "unknown",
      data: { token: "must-not-cross", nested: { raw: "private" } },
    });
    expect(received[1]).toEqual({
      runId: accepted.runId,
      provider: "codex",
      sequence: 1,
      type: "unknown",
    });
  });

  it("disposes subscriptions and provider handles", async () => {
    const test = harness();
    const accepted = await start(test);
    const received: RunEvent[] = [];
    await test.manager.subscribeRun({ runId: accepted.runId }, ({ event }) => received.push(event));
    await test.manager.shutdown();
    expect(test.runner.handle(accepted.runId).cancelCalls).toBe(1);
    test.runner.emit(accepted.runId, { type: "text_delta", role: "assistant", text: "late" });
    expect(received).toHaveLength(0);
    await expect(test.manager.startRun(request)).rejects.toMatchObject({ code: "IPC_FORBIDDEN" });
  });

  it("persists active runs as cancelled during shutdown", async () => {
    const test = harness();
    const accepted = await start(test);
    await test.manager.shutdown();
    expect(test.runner.handle(accepted.runId).cancelCalls).toBe(1);
    expect(test.persistence.getRun(accepted.runId)).toMatchObject({ status: "cancelled" });
  });

  it("preserves sanitized provider-status messages in replay clones", async () => {
    const test = harness();
    const accepted = await start(test);
    test.runner.emit(accepted.runId, { type: "provider_status", status: "ready", message: "ready now", raw: "private" });
    const subscription = await test.manager.subscribeRun({ runId: accepted.runId }, () => undefined);
    expect(subscription.replay).toEqual([{
      runId: accepted.runId,
      provider: "codex",
      sequence: 0,
      type: "provider_status",
      status: "ready",
      text: "ready now",
    }]);
  });
});
