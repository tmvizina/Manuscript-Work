import { execFile } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { basename, delimiter, extname, join, resolve } from "node:path";
import type { ExecutionProvider, ProviderSummary } from "../../shared/contracts.js";

export interface DiscoveryEnvironment {
  platform: NodeJS.Platform;
  path?: string;
  pathExt?: string;
  comSpec?: string;
  appData?: string;
  localAppData?: string;
  userProfile?: string;
}

export interface VersionProbeResult {
  stdout: string;
  stderr: string;
}

export type VersionProbe = (executablePath: string, environment: DiscoveryEnvironment) => Promise<VersionProbeResult>;
export type AuthenticationProbe = (
  provider: ExecutionProvider,
  executablePath: string,
  environment: DiscoveryEnvironment,
) => Promise<boolean>;

export interface ProviderDiscoveryOptions {
  environment?: DiscoveryEnvironment;
  isFile?: (path: string) => boolean;
  canonicalize?: (path: string) => string;
  probeVersion?: VersionProbe;
  probeAuthentication?: AuthenticationProbe;
  knownDirectories?: Partial<Record<ExecutionProvider, readonly string[]>>;
}

const COMMANDS: Record<ExecutionProvider, string> = { claude: "claude", codex: "codex" };
const VERSION_TIMEOUT_MS = 5_000;
const AUTH_TIMEOUT_MS = 5_000;

function currentEnvironment(): DiscoveryEnvironment {
  return {
    platform: process.platform,
    path: process.env.PATH,
    pathExt: process.env.PATHEXT,
    comSpec: join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe"),
    appData: process.env.APPDATA,
    localAppData: process.env.LOCALAPPDATA,
    userProfile: process.env.USERPROFILE,
  };
}

function fileExists(path: string): boolean {
  try { return statSync(path).isFile(); } catch { return false; }
}

function defaultProbe(executablePath: string, environment: DiscoveryEnvironment): Promise<VersionProbeResult> {
  const extension = extname(executablePath).toLowerCase();
  const isCommandScript = environment.platform === "win32" && (extension === ".cmd" || extension === ".bat");
  const invocation = isCommandScript
    ? commandScriptInvocation(executablePath, ["--version"], environment)
    : { command: executablePath, args: ["--version"] };
  return new Promise((resolvePromise, reject) => {
    execFile(invocation.command, invocation.args, { windowsHide: true, timeout: VERSION_TIMEOUT_MS, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
      if (error) { reject(error); return; }
      resolvePromise({ stdout, stderr });
    });
  });
}

function commandScriptInvocation(executablePath: string, args: readonly string[], environment: DiscoveryEnvironment): { command: string; args: string[] } {
  if (/[%!&|<>^"()\r\n]/.test(executablePath) || args.some((arg) => !/^[a-z0-9-]+$/i.test(arg))) {
    throw new Error("The command script path or arguments are unsafe");
  }
  return {
    command: environment.comSpec || "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/s", "/c", `"${executablePath}" ${args.join(" ")}`],
  };
}

function runStatusCommand(
  executablePath: string,
  args: readonly string[],
  environment: DiscoveryEnvironment,
): Promise<{ exitCode: number; stdout: string }> {
  const extension = extname(executablePath).toLowerCase();
  const invocation = environment.platform === "win32" && (extension === ".cmd" || extension === ".bat")
    ? commandScriptInvocation(executablePath, args, environment)
    : { command: executablePath, args: [...args] };
  return new Promise((resolvePromise, reject) => {
    execFile(invocation.command, invocation.args, { windowsHide: true, timeout: AUTH_TIMEOUT_MS, maxBuffer: 64 * 1024 }, (error, stdout) => {
      if (error) {
        const processError = error as NodeJS.ErrnoException & { killed?: boolean };
        if (!processError.killed && typeof processError.code === "number") {
          resolvePromise({ exitCode: processError.code, stdout });
          return;
        }
        reject(error);
        return;
      }
      resolvePromise({ exitCode: 0, stdout });
    });
  });
}

async function defaultAuthenticationProbe(
  provider: ExecutionProvider,
  executablePath: string,
  environment: DiscoveryEnvironment,
): Promise<boolean> {
  if (provider === "codex") {
    return (await runStatusCommand(executablePath, ["login", "status"], environment)).exitCode === 0;
  }
  const result = await runStatusCommand(executablePath, ["auth", "status", "--json"], environment);
  if (result.exitCode !== 0) return false;
  const parsed: unknown = JSON.parse(result.stdout);
  return typeof parsed === "object" && parsed !== null && (parsed as { loggedIn?: unknown }).loggedIn === true;
}

function extensions(environment: DiscoveryEnvironment): string[] {
  if (environment.platform !== "win32") return [""];
  const configured = (environment.pathExt || ".EXE;.CMD;.BAT").split(";").map((value) => value.trim().toLowerCase()).filter(Boolean);
  const allowed = [".exe", ".cmd", ".bat"];
  return allowed.filter((extension) => configured.includes(extension));
}

function pathDirectories(environment: DiscoveryEnvironment): string[] {
  const separator = environment.platform === "win32" ? ";" : delimiter;
  const seen = new Set<string>();
  const directories: string[] = [];
  for (const raw of (environment.path || "").split(separator)) {
    const trimmed = raw.trim().replace(/^"|"$/g, "");
    if (!trimmed) continue;
    const directory = resolve(trimmed);
    const key = environment.platform === "win32" ? directory.toLowerCase() : directory;
    if (seen.has(key)) continue;
    seen.add(key);
    directories.push(directory);
  }
  return directories;
}

function cleanVersion(result: VersionProbeResult): string | undefined {
  const text = `${result.stdout}\n${result.stderr}`.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  const line = text.split(/\r?\n/).map((value) => value.trim()).find(Boolean);
  if (!line) return undefined;
  return line.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 128) || undefined;
}

export class ProviderDiscovery {
  private readonly environment: DiscoveryEnvironment;
  private readonly isFile: (path: string) => boolean;
  private readonly canonicalize: (path: string) => string;
  private readonly probeVersion: VersionProbe;
  private readonly probeAuthentication: AuthenticationProbe;
  private readonly knownDirectories: Partial<Record<ExecutionProvider, readonly string[]>>;
  private readonly selectedExecutables = new Map<ExecutionProvider, string>();

  constructor(options: ProviderDiscoveryOptions = {}) {
    this.environment = options.environment ?? currentEnvironment();
    this.isFile = options.isFile ?? fileExists;
    this.canonicalize = options.canonicalize ?? ((path) => realpathSync(path));
    this.probeVersion = options.probeVersion ?? defaultProbe;
    this.probeAuthentication = options.probeAuthentication ?? defaultAuthenticationProbe;
    this.knownDirectories = options.knownDirectories ?? {
      claude: [
        ...(this.environment.userProfile ? [join(this.environment.userProfile, ".local", "bin")] : []),
        ...(this.environment.appData ? [join(this.environment.appData, "npm")] : []),
      ],
      codex: [
        ...(this.environment.appData ? [join(this.environment.appData, "npm")] : []),
        ...(this.environment.localAppData ? [join(this.environment.localAppData, "Programs", "Codex", "bin")] : []),
      ],
    };
  }

  async scan(provider?: ExecutionProvider): Promise<ProviderSummary[]> {
    const providers: ExecutionProvider[] = provider ? [provider] : ["claude", "codex"];
    return Promise.all(providers.map((item) => this.inspect(item)));
  }

  async selectExecutable(provider: ExecutionProvider, inputPath: string): Promise<ProviderSummary> {
    const candidate = resolve(inputPath);
    const extension = extname(candidate).toLowerCase();
    const expectedName = `${COMMANDS[provider]}${extension}`;
    if (![".exe", ".cmd", ".bat"].includes(extension) || basename(candidate).toLowerCase() !== expectedName) {
      throw new Error(`The selected file must be named ${provider}.exe, ${provider}.cmd, or ${provider}.bat`);
    }
    if (!this.isFile(candidate)) throw new Error("The selected provider executable is not a file");
    let canonical = candidate;
    try { canonical = this.canonicalize(candidate); } catch { /* Keep the resolved user-selected path. */ }
    this.selectedExecutables.set(provider, canonical);
    return this.inspect(provider);
  }

  private resolveExecutable(provider: ExecutionProvider): string | undefined {
    const selected = this.selectedExecutables.get(provider);
    if (selected && this.isFile(selected)) return selected;
    const seen = new Set<string>();
    const directories = [...pathDirectories(this.environment), ...(this.knownDirectories[provider] ?? [])]
      .map((directory) => resolve(directory))
      .filter((directory) => {
        const key = this.environment.platform === "win32" ? directory.toLowerCase() : directory;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    for (const directory of directories) {
      for (const extension of extensions(this.environment)) {
        const candidate = join(directory, `${COMMANDS[provider]}${extension}`);
        if (!this.isFile(candidate)) continue;
        try { return this.canonicalize(candidate); } catch { return candidate; }
      }
    }
    return undefined;
  }

  private async inspect(provider: ExecutionProvider): Promise<ProviderSummary> {
    const checkedAt = new Date().toISOString();
    const executablePath = this.resolveExecutable(provider);
    if (!executablePath) return { provider, status: "not_installed", message: `${COMMANDS[provider]} was not found on PATH`, checkedAt };
    try {
      const version = cleanVersion(await this.probeVersion(executablePath, this.environment));
      if (!version) return { provider, status: "error", executablePath, message: "The CLI was found but returned no version", checkedAt };
      const authenticated = await this.probeAuthentication(provider, executablePath, this.environment);
      return authenticated
        ? { provider, status: "ready", version, executablePath, message: "CLI detected and authenticated", checkedAt }
        : { provider, status: "auth_required", version, executablePath, message: "CLI detected; sign-in is required", checkedAt };
    } catch {
      return { provider, status: "error", executablePath, message: "The CLI was found but its version check failed", checkedAt };
    }
  }
}
