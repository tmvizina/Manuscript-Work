import { describe, expect, it, vi } from "vitest";
import type { ExecutionProvider, ProviderSummary } from "../../shared/contracts.js";
import { launchInteractiveAuth, ProviderAuthentication, type InteractiveAuthProcess, type SpawnedInteractiveProcess } from "./authentication.js";
import { ProviderDiscovery } from "./discovery.js";
import { ProviderInstallation, type ProviderInstallationUi } from "./installation.js";

const STANDARD_USER_PATHS = {
  claude: "C:\\Users\\Writer\\AppData\\Local\\Programs\\Provider Tools\\bin\\claude.exe",
  codex: "C:\\Users\\Writer\\AppData\\Roaming\\npm\\codex.cmd",
} as const;

function discoveryFor(files: readonly string[], ready: readonly ExecutionProvider[] = []): ProviderDiscovery {
  return new ProviderDiscovery({
    // A standard account can have per-user installs without WSL or Docker.
    // Keep the fixture PATH explicit so this remains a headless provider matrix
    // test rather than relying on whatever is installed on the test machine.
    environment: {
      platform: "win32",
      path: "C:\\Users\\Writer\\AppData\\Local\\Programs\\Provider Tools\\bin;C:\\Users\\Writer\\AppData\\Roaming\\npm",
      pathExt: ".EXE;.CMD;.BAT",
      comSpec: "C:\\Windows\\System32\\cmd.exe",
    },
    knownDirectories: { claude: [], codex: [] },
    isFile: (candidate) => files.includes(candidate),
    canonicalize: (candidate) => candidate,
    probeVersion: async (candidate) => ({ stdout: `${candidate.endsWith("claude.exe") ? "claude" : "codex"} 1.0.0\n`, stderr: "" }),
    probeAuthentication: async (provider) => ready.includes(provider),
  });
}

describe("Phase 7 headless provider qualification", () => {
  it.each([
    { label: "neither CLI", files: [], ready: [], expected: { claude: "not_installed", codex: "not_installed" } },
    { label: "only Claude CLI", files: [STANDARD_USER_PATHS.claude], ready: ["claude"], expected: { claude: "ready", codex: "not_installed" } },
    { label: "only Codex CLI", files: [STANDARD_USER_PATHS.codex], ready: ["codex"], expected: { claude: "not_installed", codex: "ready" } },
    { label: "both CLIs", files: Object.values(STANDARD_USER_PATHS), ready: ["claude", "codex"], expected: { claude: "ready", codex: "ready" } },
  ] as const)("reports the standard-user matrix when $label is present", async ({ files, ready, expected }) => {
    const [claude, codex] = await discoveryFor(files, ready).scan();
    expect(claude).toMatchObject({ provider: "claude", status: expected.claude });
    expect(codex).toMatchObject({ provider: "codex", status: expected.codex });
  });

  it("discovers a per-user executable whose path contains spaces", async () => {
    const service = discoveryFor([STANDARD_USER_PATHS.claude], ["claude"]);
    await expect(service.scan("claude")).resolves.toEqual([
      expect.objectContaining({
        provider: "claude",
        status: "ready",
        executablePath: STANDARD_USER_PATHS.claude,
      }),
    ]);
  });

  it("cancels authentication before an interactive process can be launched", async () => {
    let releaseScan!: (value: ProviderSummary[]) => void;
    const scan = vi.fn(() => new Promise<ProviderSummary[]>((resolve) => { releaseScan = resolve; }));
    const launchInteractive = vi.fn<() => InteractiveAuthProcess>();
    const auth = new ProviderAuthentication({
      discovery: { scan } as unknown as ProviderDiscovery,
      environment: { platform: "win32" },
      launchInteractive,
    });

    const pending = auth.authenticate("claude");
    expect(auth.cancel("claude")).toBe(true);
    releaseScan([{ provider: "claude", status: "auth_required", executablePath: STANDARD_USER_PATHS.claude }]);

    await expect(pending).resolves.toMatchObject({
      provider: "claude",
      status: "failed",
      authenticated: false,
      message: "Provider sign-in was cancelled",
    });
    expect(launchInteractive).not.toHaveBeenCalled();
    expect(auth.cancel("claude")).toBe(false);
  });

  it("keeps offline and local installer errors explicit without opening a network or installer process", async () => {
    const offlineSurface = installationUi();
    await expect(new ProviderInstallation(offlineSurface).install("claude", "embedded")).resolves.toMatchObject({
      provider: "claude",
      status: "pending_approval",
      ok: false,
      installed: false,
    });
    expect(offlineSurface.confirmOnline).not.toHaveBeenCalled();
    expect(offlineSurface.openExternal).not.toHaveBeenCalled();
    expect(offlineSurface.openPath).not.toHaveBeenCalled();

    const installerPath = "C:\\Users\\Writer\\Downloads\\Provider Tools\\Claude CLI Setup.MSI";
    const openPath = vi.fn(async () => "access denied");
    const localSurface = installationUi({
      chooseLocal: async () => installerPath,
      openPath,
    });
    await expect(new ProviderInstallation(localSurface).install("claude", "local")).resolves.toMatchObject({
      provider: "claude",
      status: "failed",
      ok: false,
      installed: false,
      message: expect.stringContaining("access denied"),
    });
    expect(openPath).toHaveBeenCalledWith(installerPath);

    const acceptedPath = vi.fn(async () => "");
    const acceptedSurface = installationUi({
      chooseLocal: async () => installerPath,
      openPath: acceptedPath,
    });
    await expect(new ProviderInstallation(acceptedSurface).install("claude", "local")).resolves.toMatchObject({
      status: "manual_action_required",
      ok: true,
      installed: false,
    });
    expect(acceptedPath).toHaveBeenCalledWith(installerPath);
  });

  it("quotes a spaced command-shim path while keeping shell execution disabled", () => {
    const listeners = new Map<string, (...args: any[]) => void>();
    const child = {
      once(event: string, listener: (...args: any[]) => void) { listeners.set(event, listener); return this; },
      kill: vi.fn(() => true),
    } as SpawnedInteractiveProcess;
    const spawnProcess = vi.fn(() => child);
    const executablePath = "C:\\Users\\Writer\\Provider Tools\\claude.cmd";

    const process = launchInteractiveAuth(
      "claude",
      executablePath,
      { platform: "win32", comSpec: "C:\\Windows\\System32\\cmd.exe" },
      spawnProcess,
    );
    expect(spawnProcess).toHaveBeenCalledWith(
      "C:\\Windows\\System32\\cmd.exe",
      ["/d", "/s", "/c", `"${executablePath}" auth login`],
      expect.objectContaining({ shell: false, windowsHide: false }),
    );
    listeners.get("close")?.(0, null);
    return expect(process.completion).resolves.toEqual({ exitCode: 0, signal: null });
  });
});

function installationUi(overrides: Partial<ProviderInstallationUi> = {}): ProviderInstallationUi {
  return {
    confirmOnline: vi.fn(async () => true),
    chooseLocal: vi.fn(async () => "C:\\Installers\\provider.exe"),
    chooseExecutable: vi.fn(async () => null),
    selectExecutable: vi.fn(async (provider, path) => ({ provider, status: "ready" as const, executablePath: path, version: "1.0.0" })),
    confirmLocal: vi.fn(async () => true),
    openExternal: vi.fn(async () => undefined),
    openPath: vi.fn(async () => ""),
    ...overrides,
  };
}
