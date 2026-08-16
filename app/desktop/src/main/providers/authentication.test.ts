import { describe, expect, it, vi } from "vitest";
import type { ProviderSummary } from "../../shared/contracts.js";
import { launchInteractiveAuth, ProviderAuthentication, type SpawnedInteractiveProcess } from "./authentication.js";
import { ProviderDiscovery } from "./discovery.js";

function discovery(sequence: ProviderSummary[]) {
  let index = 0;
  return {
    scan: vi.fn(async () => [sequence[Math.min(index++, sequence.length - 1)]!]),
  } as unknown as ProviderDiscovery;
}

describe("provider authentication", () => {
  it("uses fixed provider arguments in a distinct visible Windows console without a shell or captured streams", async () => {
    const listeners = new Map<string, (...args: any[]) => void>();
    const child = {
      once(event: string, listener: (...args: any[]) => void) { listeners.set(event, listener); return this; },
      kill: vi.fn(() => true),
    } as SpawnedInteractiveProcess;
    const spawnProcess = vi.fn(() => child);
    const process = launchInteractiveAuth("codex", "C:\\Tools\\codex.exe", { platform: "win32" }, spawnProcess);
    expect(spawnProcess).toHaveBeenCalledWith("C:\\Tools\\codex.exe", ["login"], {
      detached: true, shell: false, stdio: "inherit", windowsHide: false,
    });
    listeners.get("close")?.(0, null);
    await expect(process.completion).resolves.toEqual({ exitCode: 0, signal: null });
    expect(process.cancel()).toBe(true);
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("constrains command shims to trusted ComSpec and rejects shell metacharacters", () => {
    const child = { once() { return this; }, kill: () => true } as SpawnedInteractiveProcess;
    const spawnProcess = vi.fn(() => child);
    launchInteractiveAuth("claude", "C:\\Tools\\claude.cmd", { platform: "win32", comSpec: "C:\\Windows\\cmd.exe" }, spawnProcess);
    expect(spawnProcess).toHaveBeenCalledWith("C:\\Windows\\cmd.exe", ["/d", "/s", "/c", '"C:\\Tools\\claude.cmd" auth login'], expect.objectContaining({ shell: false }));
    expect(() => launchInteractiveAuth("claude", "C:\\Bad&Path\\claude.cmd", { platform: "win32" }, spawnProcess)).toThrow("unsafe");
  });

  it("launches only the discovered provider executable and verifies readiness afterward", async () => {
    const serviceDiscovery = discovery([
      { provider: "claude", status: "auth_required", executablePath: "C:\\Tools\\claude.exe" },
      { provider: "claude", status: "ready", executablePath: "C:\\Tools\\claude.exe" },
    ]);
    const launchInteractive = vi.fn(() => ({ completion: Promise.resolve({ exitCode: 0, signal: null }), cancel: vi.fn(() => true) }));
    const auth = new ProviderAuthentication({
      discovery: serviceDiscovery,
      environment: { platform: "win32" },
      launchInteractive,
    });

    await expect(auth.authenticate("claude")).resolves.toEqual({
      provider: "claude", status: "authenticated", ok: true, authenticated: true, message: "Authentication verified",
    });
    expect(launchInteractive).toHaveBeenCalledWith("claude", "C:\\Tools\\claude.exe", { platform: "win32" });
    expect(serviceDiscovery.scan).toHaveBeenCalledTimes(2);
  });

  it("does not launch missing providers or claim readiness after an unverified login", async () => {
    const missingLaunch = vi.fn();
    const missing = new ProviderAuthentication({
      discovery: discovery([{ provider: "codex", status: "not_installed", message: "not found" }]),
      environment: { platform: "win32" },
      launchInteractive: missingLaunch,
    });
    await expect(missing.authenticate("codex")).resolves.toMatchObject({ status: "failed", authenticated: false });
    expect(missingLaunch).not.toHaveBeenCalled();

    const unverified = new ProviderAuthentication({
      discovery: discovery([
        { provider: "codex", status: "auth_required", executablePath: "C:\\Tools\\codex.exe" },
        { provider: "codex", status: "auth_required", executablePath: "C:\\Tools\\codex.exe" },
      ]),
      environment: { platform: "win32" },
      launchInteractive: () => ({ completion: Promise.resolve({ exitCode: 0, signal: null }), cancel: vi.fn(() => true) }),
    });
    await expect(unverified.authenticate("codex")).resolves.toMatchObject({ status: "auth_required", authenticated: false, ok: false });

    const rejected = new ProviderAuthentication({
      discovery: discovery([{ provider: "claude", status: "auth_required", executablePath: "C:\\Tools\\claude.exe" }]),
      environment: { platform: "win32" },
      launchInteractive: () => ({ completion: Promise.resolve({ exitCode: 1, signal: null }), cancel: () => true }),
    });
    await expect(rejected.authenticate("claude")).resolves.toMatchObject({
      status: "failed", authenticated: false, message: "The provider sign-in command did not complete successfully",
    });
  });

  it("deduplicates concurrent sign-in requests and cancels the owned process idempotently", async () => {
    let resolveLaunch!: (value: { exitCode: number | null; signal: NodeJS.Signals | null }) => void;
    const cancel = vi.fn(() => true);
    const launchInteractive = vi.fn(() => ({
      completion: new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => { resolveLaunch = resolve; }),
      cancel,
    }));
    const auth = new ProviderAuthentication({
      discovery: discovery([{ provider: "claude", status: "auth_required", executablePath: "C:\\Tools\\claude.exe" }]),
      environment: { platform: "win32" },
      launchInteractive,
    });
    const first = auth.authenticate("claude");
    const second = auth.authenticate("claude");
    await Promise.resolve();
    await Promise.resolve();
    expect(auth.cancel("claude")).toBe(true);
    expect(auth.cancel("claude")).toBe(true);
    resolveLaunch({ exitCode: null, signal: "SIGTERM" });
    await expect(first).resolves.toMatchObject({ status: "failed", authenticated: false, message: "Provider sign-in was cancelled" });
    await expect(second).resolves.toMatchObject({ status: "failed", authenticated: false });
    expect(launchInteractive).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(auth.cancel("claude")).toBe(false);
  });
});
