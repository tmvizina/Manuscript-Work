import { spawn, type SpawnOptions } from "node:child_process";
import { extname, join } from "node:path";
import type { AuthResult, ExecutionProvider, ProviderSummary } from "../../shared/contracts.js";
import { ProviderDiscovery, type DiscoveryEnvironment } from "./discovery.js";

export interface InteractiveAuthExit {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface InteractiveAuthProcess {
  completion: Promise<InteractiveAuthExit>;
  cancel(): boolean;
}

export type InteractiveAuthLauncher = (
  provider: ExecutionProvider,
  executablePath: string,
  environment: DiscoveryEnvironment,
) => InteractiveAuthProcess;

export interface ProviderAuthenticationOptions {
  discovery: ProviderDiscovery;
  environment?: DiscoveryEnvironment;
  launchInteractive?: InteractiveAuthLauncher;
}

export interface SpawnedInteractiveProcess {
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "close", listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(): boolean;
}

export type SpawnInteractiveProcess = (command: string, args: readonly string[], options: SpawnOptions) => SpawnedInteractiveProcess;

const AUTH_ARGS: Record<ExecutionProvider, readonly string[]> = {
  claude: ["auth", "login"],
  codex: ["login"],
};

function currentEnvironment(): DiscoveryEnvironment {
  return {
    platform: process.platform,
    path: process.env.PATH,
    pathExt: process.env.PATHEXT,
    comSpec: join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe"),
  };
}

function commandScriptInvocation(
  executablePath: string,
  args: readonly string[],
  environment: DiscoveryEnvironment,
): { command: string; args: string[] } {
  if (/[%!&|<>^"()\r\n]/.test(executablePath) || args.some((arg) => !/^[a-z0-9-]+$/i.test(arg))) {
    throw new Error("The command script path or arguments are unsafe");
  }
  return {
    command: environment.comSpec || "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/s", "/c", `"${executablePath}" ${args.join(" ")}`],
  };
}

export function launchInteractiveAuth(
  provider: ExecutionProvider,
  executablePath: string,
  environment: DiscoveryEnvironment,
  spawnProcess: SpawnInteractiveProcess = spawn,
): InteractiveAuthProcess {
  if (environment.platform !== "win32") {
    return {
      completion: Promise.reject(new Error("Visible provider authentication is currently supported only on Windows")),
      cancel: () => false,
    };
  }
  const providerArgs = AUTH_ARGS[provider];
  const extension = extname(executablePath).toLowerCase();
  const invocation = extension === ".cmd" || extension === ".bat"
    ? commandScriptInvocation(executablePath, providerArgs, environment)
    : { command: executablePath, args: [...providerArgs] };

  const child = spawnProcess(invocation.command, invocation.args, {
    // Node creates a distinct console window for detached Windows children.
    // Keeping the child referenced still lets this service wait and cancel it.
    detached: true,
    shell: false,
    stdio: "inherit",
    windowsHide: false,
  });
  const completion = new Promise<InteractiveAuthExit>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  });
  return { completion, cancel: () => child.kill() };
}

function failed(provider: ExecutionProvider, message: string): AuthResult {
  return { provider, status: "failed", ok: false, authenticated: false, message };
}

function resultFromSummary(summary: ProviderSummary): AuthResult {
  if (summary.status === "ready") {
    return { provider: summary.provider, status: "authenticated", ok: true, authenticated: true, message: "Authentication verified" };
  }
  if (summary.status === "auth_required") {
    return { provider: summary.provider, status: "auth_required", ok: false, authenticated: false, message: "Sign-in was not verified" };
  }
  return failed(summary.provider, summary.message ?? "The provider is unavailable");
}

export class ProviderAuthentication {
  private readonly discovery: ProviderDiscovery;
  private readonly environment: DiscoveryEnvironment;
  private readonly launchInteractive: InteractiveAuthLauncher;
  private readonly active = new Map<ExecutionProvider, { promise: Promise<AuthResult>; process?: InteractiveAuthProcess; cancelled: boolean }>();

  constructor(options: ProviderAuthenticationOptions) {
    this.discovery = options.discovery;
    this.environment = options.environment ?? currentEnvironment();
    this.launchInteractive = options.launchInteractive ?? launchInteractiveAuth;
  }

  authenticate(provider: ExecutionProvider): Promise<AuthResult> {
    const existing = this.active.get(provider);
    if (existing) return existing.promise;
    const session: { promise: Promise<AuthResult>; process?: InteractiveAuthProcess; cancelled: boolean } = {
      promise: Promise.resolve(failed(provider, "Authentication has not started")),
      cancelled: false,
    };
    const pending = this.authenticateOnce(provider, session).finally(() => this.active.delete(provider));
    session.promise = pending;
    this.active.set(provider, session);
    return pending;
  }

  cancel(provider: ExecutionProvider): boolean {
    const session = this.active.get(provider);
    if (!session) return false;
    if (session.cancelled) return true;
    session.cancelled = true;
    session.process?.cancel();
    return true;
  }

  cancelAll(): void {
    for (const provider of this.active.keys()) this.cancel(provider);
  }

  private async authenticateOnce(
    provider: ExecutionProvider,
    session: { process?: InteractiveAuthProcess; cancelled: boolean },
  ): Promise<AuthResult> {
    const before = (await this.discovery.scan(provider))[0];
    if (session.cancelled) return failed(provider, "Provider sign-in was cancelled");
    if (!before) return failed(provider, "The provider could not be inspected");
    if (before.status === "ready") return resultFromSummary(before);
    if (before.status !== "auth_required" || !before.executablePath) return resultFromSummary(before);

    try {
      const process = this.launchInteractive(provider, before.executablePath, this.environment);
      session.process = process;
      if (session.cancelled) process.cancel();
      const exit = await process.completion;
      if (session.cancelled) return failed(provider, "Provider sign-in was cancelled");
      if (exit.exitCode !== 0) {
        return failed(provider, exit.signal ? "The sign-in terminal was closed" : "The provider sign-in command did not complete successfully");
      }
      const after = (await this.discovery.scan(provider))[0];
      return after ? resultFromSummary(after) : failed(provider, "Authentication could not be verified");
    } catch {
      return failed(provider, "The provider sign-in terminal could not be opened");
    }
  }
}
