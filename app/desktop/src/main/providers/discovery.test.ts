import { describe, expect, it } from "vitest";
import { ProviderDiscovery } from "./discovery.js";

function discovery(files: string[], versions: Record<string, string | Error>) {
  return new ProviderDiscovery({
    environment: { platform: "win32", path: "C:\\Tools;C:\\Users\\Writer\\AppData\\Roaming\\npm;C:\\Tools", pathExt: ".EXE;.CMD", comSpec: "C:\\Windows\\cmd.exe" },
    isFile: (path) => files.includes(path),
    canonicalize: (path) => path,
    probeVersion: async (path) => {
      const value = versions[path];
      if (value instanceof Error) throw value;
      return { stdout: value ?? "", stderr: "" };
    },
    probeAuthentication: async () => false,
  });
}

describe("provider discovery", () => {
  it("detects both CLIs, prefers executables, and records bounded versions", async () => {
    const service = discovery([
      "C:\\Tools\\claude.exe",
      "C:\\Tools\\claude.cmd",
      "C:\\Users\\Writer\\AppData\\Roaming\\npm\\codex.cmd",
    ], {
      "C:\\Tools\\claude.exe": "claude 2.1.0\n",
      "C:\\Users\\Writer\\AppData\\Roaming\\npm\\codex.cmd": "codex-cli 0.143.0\n",
    });
    await expect(service.scan()).resolves.toEqual([
      expect.objectContaining({ provider: "claude", status: "auth_required", executablePath: "C:\\Tools\\claude.exe", version: "claude 2.1.0" }),
      expect.objectContaining({ provider: "codex", status: "auth_required", executablePath: "C:\\Users\\Writer\\AppData\\Roaming\\npm\\codex.cmd", version: "codex-cli 0.143.0" }),
    ]);
  });

  it("reports missing and failed version checks without throwing", async () => {
    const service = discovery(["C:\\Tools\\claude.exe"], { "C:\\Tools\\claude.exe": new Error("timeout") });
    const statuses = await service.scan();
    expect(statuses[0]).toMatchObject({ provider: "claude", status: "error", executablePath: "C:\\Tools\\claude.exe" });
    expect(statuses[1]).toMatchObject({ provider: "codex", status: "not_installed" });
  });

  it("can rescan one provider after installation", async () => {
    const service = discovery(["C:\\Tools\\codex.exe"], { "C:\\Tools\\codex.exe": "codex 1.0.0" });
    await expect(service.scan("codex")).resolves.toEqual([expect.objectContaining({ provider: "codex", status: "auth_required" })]);
  });

  it("reports ready only after the provider authentication probe succeeds", async () => {
    const service = new ProviderDiscovery({
      environment: { platform: "win32", path: "C:\\Tools", pathExt: ".EXE" },
      isFile: (path) => path === "C:\\Tools\\claude.exe",
      canonicalize: (path) => path,
      probeVersion: async () => ({ stdout: "claude 2.1.0", stderr: "" }),
      probeAuthentication: async (provider, path) => provider === "claude" && path === "C:\\Tools\\claude.exe",
    });
    await expect(service.scan("claude")).resolves.toEqual([
      expect.objectContaining({ provider: "claude", status: "ready", message: "CLI detected and authenticated" }),
    ]);
  });
});
