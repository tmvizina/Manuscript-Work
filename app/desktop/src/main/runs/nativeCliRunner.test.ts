import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { NativeCliRunner, providerArguments, providerInvocation } from "./nativeCliRunner.js";

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => true);
}

function readyDiscovery(provider: "claude" | "codex", executablePath: string) {
  return {
    scan: vi.fn(async () => [{
      provider,
      status: "ready" as const,
      executablePath,
      version: "test-1",
      checkedAt: "2026-08-16T00:00:00.000Z",
    }]),
  };
}

describe("native CLI runner", () => {
  it("constructs fixed provider arguments and sends prompts over stdin", async () => {
    const child = new FakeChild();
    let prompt = "";
    child.stdin.setEncoding("utf8");
    child.stdin.on("data", (chunk: string) => { prompt += chunk; });
    const spawnProcess = vi.fn(() => child as unknown as ChildProcessWithoutNullStreams);
    const runner = new NativeCliRunner({
      discovery: readyDiscovery("claude", "C:\\Tools\\claude.exe"),
      resolveCwd: () => "C:\\Writing Project",
      spawnProcess,
      platform: "win32",
    });

    const handle = await runner.start({
      runId: "run-1",
      provider: "claude",
      prompt: "Synthetic smoke prompt",
      permissionMode: "plan",
      model: "claude-test",
    });

    expect(spawnProcess).toHaveBeenCalledWith(
      "C:\\Tools\\claude.exe",
      ["-p", "--verbose", "--output-format", "stream-json", "--no-session-persistence", "--permission-mode", "plan", "--model", "claude-test"],
      expect.objectContaining({ cwd: "C:\\Writing Project", shell: false, windowsHide: true }),
    );
    expect(prompt).toBe("Synthetic smoke prompt");

    const events: string[] = [];
    handle.subscribe((event) => events.push(event.type));
    child.emit("spawn");
    child.stdout.write('{"type":"system","subtype":"init","session_id":"s1"}\n');
    child.stdout.write('{"type":"result","subtype":"success","is_error":false,"result":"ok"}\n');
    child.emit("close", 0, null);

    await expect(handle.wait()).resolves.toMatchObject({ status: "completed", resultText: "ok", exitCode: 0 });
    expect(events).toEqual(["run_started", "run_completed"]);
  });

  it("fails closed when discovery does not return an authenticated executable", async () => {
    const runner = new NativeCliRunner({
      discovery: { scan: async () => [{ provider: "codex", status: "auth_required", message: "sign in", checkedAt: "now" }] },
      spawnProcess: vi.fn(),
    });
    await expect(runner.start({ runId: "run-2", provider: "codex", prompt: "test" })).rejects.toMatchObject({
      code: "PROVIDER_NOT_READY",
    });
  });

  it("maps Codex plan mode to a read-only sandbox and validates model names", () => {
    expect(providerArguments({ runId: "run-3", provider: "codex", prompt: "x", permissionMode: "plan" }))
      .toEqual(["exec", "--json", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "--ask-for-approval", "never", "-"]);
    expect(providerArguments({ runId: "run-3b", provider: "codex", prompt: "x", permissionMode: "acceptEdits" }))
      .toContain("workspace-write");
    expect(providerArguments({ runId: "run-3c", provider: "claude", prompt: "x" }))
      .toContain("dontAsk");
    expect(() => providerArguments({ runId: "run-4", provider: "codex", prompt: "x", model: "bad & calc" }))
      .toThrow(/unsupported characters/);
  });

  it("wraps Windows command shims with expansion disabled", () => {
    expect(providerInvocation("C:\\Program Files\\Codex\\codex.cmd", ["exec", "--json", "-"], "win32", "C:\\Windows\\cmd.exe"))
      .toEqual({
        command: "C:\\Windows\\cmd.exe",
        args: ["/d", "/v:off", "/s", "/c", '""C:\\Program Files\\Codex\\codex.cmd" exec --json -"'],
      });
    expect(() => providerInvocation("C:\\Bad&Path\\codex.cmd", ["exec", "--json", "-"], "win32"))
      .toThrow(/cannot be invoked safely/);
  });

  it("cancels the owned provider process directly off Windows", async () => {
    const child = new FakeChild();
    const runner = new NativeCliRunner({
      discovery: readyDiscovery("codex", "/usr/local/bin/codex"),
      spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
      platform: "linux",
    });
    const handle = await runner.start({ runId: "run-5", provider: "codex", prompt: "test" });
    expect(await handle.cancel()).toBe(true);
    expect(child.kill).toHaveBeenCalledOnce();
    child.emit("close", null, "SIGTERM");
    await expect(handle.wait()).resolves.toMatchObject({ status: "cancelled" });
  });

  it("cancels a direct Windows executable as a scoped process tree", async () => {
    // A standalone .exe can spawn its own helpers; killing only the process we
    // own would strand them after a cancelled run.
    const child = new FakeChild();
    Object.defineProperty(child, "pid", { value: 9876 });
    const killProcessTree = vi.fn();
    const runner = new NativeCliRunner({
      discovery: readyDiscovery("codex", "C:\\Tools\\codex.exe"),
      spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
      killProcessTree,
      platform: "win32",
    });
    const handle = await runner.start({ runId: "run-5a", provider: "codex", prompt: "test" });
    expect(await handle.cancel()).toBe(true);
    expect(killProcessTree).toHaveBeenCalledWith(9876);
    expect(child.kill).not.toHaveBeenCalled();
    child.emit("close", null, "SIGTERM");
    await expect(handle.wait()).resolves.toMatchObject({ status: "cancelled" });
  });

  it("cancels a Windows command shim as a scoped process tree", async () => {
    const child = new FakeChild();
    Object.defineProperty(child, "pid", { value: 4321 });
    const killProcessTree = vi.fn();
    const runner = new NativeCliRunner({
      discovery: readyDiscovery("codex", "C:\\Tools\\codex.cmd"),
      spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
      killProcessTree,
      platform: "win32",
      comSpec: "C:\\Windows\\System32\\cmd.exe",
    });
    const handle = await runner.start({ runId: "run-5b", provider: "codex", prompt: "test" });
    expect(await handle.cancel()).toBe(true);
    expect(killProcessTree).toHaveBeenCalledWith(4321);
    expect(child.kill).not.toHaveBeenCalled();
    child.emit("close", null, "SIGTERM");
    await expect(handle.wait()).resolves.toMatchObject({ status: "cancelled" });
  });

  it("normalizes a successful Codex JSONL stream and retains the final answer", async () => {
    const child = new FakeChild();
    const runner = new NativeCliRunner({
      discovery: readyDiscovery("codex", "C:\\Tools\\codex.exe"),
      spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
      platform: "win32",
    });
    const handle = await runner.start({ runId: "run-6", provider: "codex", prompt: "test" });
    const events: string[] = [];
    handle.subscribe((event) => events.push(event.type));
    child.emit("spawn");
    child.stdout.write('{"type":"thread.started","thread_id":"t1"}\r\n');
    child.stdout.write('{"type":"item.completed","item":{"id":"m1","type":"agent_message","text":"P4_SMOKE_OK"}}\n');
    child.stdout.write('{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n');
    child.emit("close", 0, null);
    await expect(handle.wait()).resolves.toMatchObject({ status: "completed", resultText: "P4_SMOKE_OK", usage: { inputTokens: 1, outputTokens: 1 } });
    expect(events).toEqual(["run_started", "text_delta", "run_completed"]);
  });

  it("fails closed on malformed or unterminated provider output", async () => {
    const child = new FakeChild();
    const runner = new NativeCliRunner({
      discovery: readyDiscovery("codex", "C:\\Tools\\codex.exe"),
      spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
    });
    const handle = await runner.start({ runId: "run-7", provider: "codex", prompt: "test" });
    const events: string[] = [];
    handle.subscribe((event) => events.push(event.type));
    child.stdout.write("not-json\n");
    child.stderr.write("provider\u0000 failure");
    child.emit("close", 0, null);
    await expect(handle.wait()).resolves.toMatchObject({ status: "failed", error: "provider failure" });
    expect(events).toEqual(["malformed"]);
  });

  it("rejects oversized prompts before discovery or process launch", async () => {
    const discovery = readyDiscovery("claude", "C:\\Tools\\claude.exe");
    const spawnProcess = vi.fn();
    const runner = new NativeCliRunner({ discovery, spawnProcess });
    await expect(runner.start({ runId: "run-8", provider: "claude", prompt: "x".repeat(1024 * 1024 + 1) }))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(discovery.scan).not.toHaveBeenCalled();
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});
