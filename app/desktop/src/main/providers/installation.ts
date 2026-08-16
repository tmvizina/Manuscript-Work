import type { ExecutionProvider, InstallResult, InstallSource, ProviderSummary } from "../../shared/contracts.js";

export const PROVIDER_INSTALL_PAGES: Record<ExecutionProvider, string> = {
  claude: "https://docs.anthropic.com/en/docs/claude-code/getting-started",
  codex: "https://learn.chatgpt.com/docs/codex/cli",
};

export interface ProviderInstallationUi {
  confirmOnline(provider: ExecutionProvider, page: string): Promise<boolean>;
  chooseLocal(provider: ExecutionProvider): Promise<string | null>;
  chooseExecutable(provider: ExecutionProvider): Promise<string | null>;
  selectExecutable(provider: ExecutionProvider, path: string): Promise<ProviderSummary>;
  confirmLocal(provider: ExecutionProvider, path: string): Promise<boolean>;
  openExternal(page: string): Promise<void>;
  openPath(path: string): Promise<string>;
}

export class ProviderInstallation {
  constructor(private readonly ui: ProviderInstallationUi) {}

  async install(provider: ExecutionProvider, source: InstallSource): Promise<InstallResult> {
    if (source === "embedded") {
      return {
        provider,
        status: "pending_approval",
        ok: false,
        installed: false,
        message: "Offline installation is disabled until a pinned provider payload has approved redistribution terms and verified publisher metadata.",
      };
    }
    if (source === "online") {
      const page = PROVIDER_INSTALL_PAGES[provider];
      if (!await this.ui.confirmOnline(provider, page)) {
        return { provider, status: "cancelled", ok: false, installed: false, message: "Online installation was cancelled." };
      }
      try {
        await this.ui.openExternal(page);
        return { provider, status: "opened_external", ok: true, installed: false, message: "Official installation instructions opened. Complete them, then rescan providers." };
      } catch {
        return { provider, status: "failed", ok: false, installed: false, message: "The official installation page could not be opened." };
      }
    }

    if (source === "executable") {
      const executablePath = await this.ui.chooseExecutable(provider);
      if (!executablePath) return { provider, status: "cancelled", ok: false, installed: false, message: "Provider executable selection was cancelled." };
      try {
        const summary = await this.ui.selectExecutable(provider, executablePath);
        if (summary.provider !== provider || (summary.status !== "ready" && summary.status !== "auth_required")) {
          return { provider, status: "failed", ok: false, installed: false, message: summary.message ?? "The selected provider executable could not be verified." };
        }
        return {
          provider,
          status: "already_installed",
          ok: true,
          installed: true,
          version: summary.version,
          executablePath: summary.executablePath,
          message: summary.status === "ready" ? "Provider executable selected and ready." : "Provider executable selected. Sign-in is required.",
        };
      } catch (error) {
        return { provider, status: "failed", ok: false, installed: false, message: error instanceof Error ? error.message : "The selected provider executable could not be verified." };
      }
    }

    const installerPath = await this.ui.chooseLocal(provider);
    if (!installerPath) return { provider, status: "cancelled", ok: false, installed: false, message: "Local installer selection was cancelled." };
    if (!/\.(?:exe|msi)$/i.test(installerPath)) return { provider, status: "failed", ok: false, installed: false, message: "Only .exe and .msi installers can be opened." };
    if (!await this.ui.confirmLocal(provider, installerPath)) {
      return { provider, status: "cancelled", ok: false, installed: false, message: "Local installer launch was cancelled." };
    }
    const error = await this.ui.openPath(installerPath);
    return error
      ? { provider, status: "failed", ok: false, installed: false, message: `Windows could not open the installer: ${error}` }
      : { provider, status: "manual_action_required", ok: true, installed: false, message: "Installer opened. Complete it, then rescan providers." };
  }
}
