import { describe, expect, it, vi } from "vitest";
import { ProviderInstallation, type ProviderInstallationUi } from "./installation.js";

function ui(overrides: Partial<ProviderInstallationUi> = {}): ProviderInstallationUi {
  return {
    confirmOnline: vi.fn(async () => true),
    chooseLocal: vi.fn(async () => "C:\\Installers\\provider.exe"),
    chooseExecutable: vi.fn(async () => "C:\\Tools\\claude.exe"),
    selectExecutable: vi.fn(async (provider, path) => ({ provider, status: "ready", executablePath: path, version: "test", checkedAt: "now" })),
    confirmLocal: vi.fn(async () => true),
    openExternal: vi.fn(async () => undefined),
    openPath: vi.fn(async () => ""),
    ...overrides,
  };
}

describe("provider installation recovery", () => {
  it("keeps embedded installation behind explicit release approval", async () => {
    await expect(new ProviderInstallation(ui()).install("claude", "embedded")).resolves.toMatchObject({
      provider: "claude", status: "pending_approval", ok: false, installed: false,
    });
  });

  it("opens only the fixed official page after confirmation", async () => {
    const surface = ui();
    await expect(new ProviderInstallation(surface).install("codex", "online")).resolves.toMatchObject({ status: "opened_external", ok: true });
    expect(surface.confirmOnline).toHaveBeenCalledWith("codex", "https://learn.chatgpt.com/docs/codex/cli");
    expect(surface.openExternal).toHaveBeenCalledWith("https://learn.chatgpt.com/docs/codex/cli");
  });

  it("reports online cancellation and open failure without claiming installation", async () => {
    await expect(new ProviderInstallation(ui({ confirmOnline: async () => false })).install("claude", "online")).resolves.toMatchObject({ status: "cancelled", installed: false });
    await expect(new ProviderInstallation(ui({ openExternal: async () => { throw new Error("blocked"); } })).install("claude", "online")).resolves.toMatchObject({ status: "failed", installed: false });
  });

  it("validates, confirms, and reports local installer handoff outcomes", async () => {
    await expect(new ProviderInstallation(ui({ chooseLocal: async () => null })).install("claude", "local")).resolves.toMatchObject({ status: "cancelled" });
    await expect(new ProviderInstallation(ui({ chooseLocal: async () => "C:\\bad.ps1" })).install("claude", "local")).resolves.toMatchObject({ status: "failed" });
    await expect(new ProviderInstallation(ui({ confirmLocal: async () => false })).install("claude", "local")).resolves.toMatchObject({ status: "cancelled" });
    await expect(new ProviderInstallation(ui({ openPath: async () => "access denied" })).install("claude", "local")).resolves.toMatchObject({ status: "failed", message: expect.stringContaining("access denied") });
    await expect(new ProviderInstallation(ui()).install("claude", "local")).resolves.toMatchObject({ status: "manual_action_required", ok: true, installed: false });
  });

  it("selects and verifies an already-installed executable without accepting a renderer path", async () => {
    const surface = ui();
    await expect(new ProviderInstallation(surface).install("claude", "executable")).resolves.toMatchObject({
      status: "already_installed", installed: true, executablePath: "C:\\Tools\\claude.exe",
    });
    expect(surface.selectExecutable).toHaveBeenCalledWith("claude", "C:\\Tools\\claude.exe");
    await expect(new ProviderInstallation(ui({ chooseExecutable: async () => null })).install("claude", "executable")).resolves.toMatchObject({ status: "cancelled" });
    await expect(new ProviderInstallation(ui({ selectExecutable: async () => { throw new Error("wrong filename"); } })).install("claude", "executable")).resolves.toMatchObject({ status: "failed", message: "wrong filename" });
  });
});
