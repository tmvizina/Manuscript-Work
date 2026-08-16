import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { extname, join, resolve } from "node:path";
import {
  parseProviderJsonl,
  type ExecutionProvider,
  type RunEvent as CoreRunEvent,
  type RunUsage,
} from "@book-writer/core";
import { BookWriterError, IPC_ERROR_CODES } from "../../shared/errors.js";
import { RUN_REPLAY_LIMIT, type ProviderSummary } from "../../shared/contracts.js";
import type { ProviderDiscovery } from "../providers/discovery.js";
import type { ProviderRunRequest, ProviderRunResult, ProviderRunner, RunHandle } from "./contracts.js";

const MAX_PENDING_LINE = 1024 * 1024;
const MAX_STDERR = 64 * 1024;
const MAX_PROMPT = 1024 * 1024;
const MAX_STDOUT = 16 * 1024 * 1024;

type ProcessSpawner = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;
type ProcessTreeKiller = (pid: number) => void;

export interface NativeCliRunnerOptions {
  discovery: Pick<ProviderDiscovery, "scan">;
  resolveCwd?: (request: ProviderRunRequest) => string;
  spawnProcess?: ProcessSpawner;
  platform?: NodeJS.Platform;
  comSpec?: string;
  killProcessTree?: ProcessTreeKiller;
}

interface Invocation {
  command: string;
  args: string[];
}

function modelArgument(model: string | undefined): string | undefined {
  if (model === undefined) return undefined;
  if (!/^[a-z0-9][a-z0-9._:/-]{0,127}$/i.test(model)) {
    throw new BookWriterError({
      code: IPC_ERROR_CODES.invalidArgument,
      message: "The provider model name contains unsupported characters",
      operation: "runs.start",
    });
  }
  return model;
}

export function providerArguments(request: ProviderRunRequest): string[] {
  const model = modelArgument(request.model);
  if (request.provider === "claude") {
    const permissionMode = request.permissionMode === "acceptEdits"
      ? "acceptEdits"
      : request.permissionMode === "plan" ? "plan" : "dontAsk";
    const args = [
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--no-session-persistence",
      "--permission-mode",
      permissionMode,
    ];
    if (model) args.push("--model", model);
    return args;
  }

  const sandbox = request.permissionMode === "acceptEdits" ? "workspace-write" : "read-only";
  const args = ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "--sandbox", sandbox, "--ask-for-approval", "never"];
  if (model) args.push("--model", model);
  args.push("-");
  return args;
}

function commandScriptInvocation(
  executablePath: string,
  args: readonly string[],
  comSpec: string | undefined,
): Invocation {
  // The executable is discovered by the main process and every argument is
  // generated above. Reject cmd expansion/control characters as a final
  // defence before constructing the one command string cmd.exe requires.
  if (/[%!&|<>^"()\r\n]/.test(executablePath) || args.some((arg) => !/^[a-z0-9._:/-]+$/i.test(arg))) {
    throw new BookWriterError({
      code: IPC_ERROR_CODES.invalidArgument,
      message: "The discovered command script cannot be invoked safely",
      operation: "runs.start",
    });
  }
  const commandLine = `"${executablePath}" ${args.join(" ")}`;
  return {
    command: comSpec || "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/v:off", "/s", "/c", `"${commandLine}"`],
  };
}

export function providerInvocation(
  executablePath: string,
  args: readonly string[],
  platform: NodeJS.Platform,
  comSpec?: string,
): Invocation {
  const extension = extname(executablePath).toLowerCase();
  if (platform === "win32" && (extension === ".cmd" || extension === ".bat")) {
    return commandScriptInvocation(executablePath, args, comSpec);
  }
  return { command: executablePath, args: [...args] };
}

class NativeCliRunHandle implements RunHandle {
  readonly runId: string;
  readonly provider: ExecutionProvider;
  readonly request: ProviderRunRequest;
  status: "starting" | "running" | "completed" | "failed" | "cancelled" = "starting";
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly listeners = new Set<(event: CoreRunEvent) => void>();
  private readonly queued: CoreRunEvent[] = [];
  private readonly completion: Promise<ProviderRunResult>;
  private resolveCompletion!: (result: ProviderRunResult) => void;
  private pending = "";
  private stderr = "";
  private settled = false;
  private stdoutBytes = 0;
  private cancelRequested = false;
  private terminalStatus: "completed" | "failed" | null = null;
  private resultText: string | undefined;
  private usage: RunUsage | undefined;

  constructor(request: ProviderRunRequest, child: ChildProcessWithoutNullStreams, private readonly killProcessTree?: ProcessTreeKiller) {
    this.runId = request.runId;
    this.provider = request.provider;
    this.request = request;
    this.child = child;
    this.completion = new Promise((resolvePromise) => { this.resolveCompletion = resolvePromise; });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.consume(chunk));
    child.stderr.on("data", (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-MAX_STDERR);
    });
    child.once("spawn", () => { this.status = "running"; });
    child.once("error", (error) => this.finishFromError(error));
    child.once("close", (code) => this.finishFromExit(code));
    child.stdin.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE" && !this.cancelRequested) this.finishFromError(error);
    });
    child.stdin.end(request.prompt, "utf8");
  }

  subscribe(listener: (event: CoreRunEvent) => void): () => void {
    this.listeners.add(listener);
    for (const event of this.queued.splice(0)) listener(event);
    return () => this.listeners.delete(listener);
  }

  cancel(): boolean {
    if (this.settled || this.cancelRequested) return false;
    this.cancelRequested = true;
    this.status = "cancelled";
    if (this.killProcessTree && typeof this.child.pid === "number") {
      this.killProcessTree(this.child.pid);
      return true;
    }
    return this.child.kill();
  }

  wait(): Promise<ProviderRunResult> {
    return this.completion;
  }

  private emit(event: CoreRunEvent): void {
    if (event.type === "run_completed") {
      this.terminalStatus = "completed";
      this.resultText = event.result ?? this.resultText;
      this.usage = event.usage ?? this.usage;
    } else if (event.type === "run_failed") {
      this.terminalStatus = "failed";
      this.resultText = event.result ?? this.resultText;
    } else if (event.type === "text_delta" && event.role === "assistant" && event.final) {
      this.resultText = event.text;
    }
    if (this.listeners.size === 0) {
      this.queued.push(event);
      if (this.queued.length > RUN_REPLAY_LIMIT) this.queued.splice(0, this.queued.length - RUN_REPLAY_LIMIT);
    }
    else for (const listener of [...this.listeners]) listener(event);
  }

  private consume(chunk: string): void {
    this.stdoutBytes += Buffer.byteLength(chunk, "utf8");
    if (this.stdoutBytes > MAX_STDOUT) {
      this.finishFromError(new Error("Provider output exceeded the 16 MiB run safety limit"));
      this.child.kill();
      return;
    }
    this.pending += chunk;
    if (this.pending.length > MAX_PENDING_LINE) {
      this.finishFromError(new Error("Provider output exceeded the maximum JSONL line length"));
      this.child.kill();
      return;
    }
    const lines = this.pending.split(/\r?\n/);
    this.pending = lines.pop() ?? "";
    for (const line of lines) this.consumeLine(line);
  }

  private consumeLine(line: string): void {
    if (!line.trim()) return;
    const parsed = parseProviderJsonl(this.provider, [line]);
    for (const event of parsed.events) this.emit(event);
  }

  private finishFromError(error: unknown): void {
    if (this.settled) return;
    this.settled = true;
    this.status = this.cancelRequested ? "cancelled" : "failed";
    this.resolveCompletion({
      runId: this.runId,
      provider: this.provider,
      status: this.status,
      error,
      resultText: this.resultText,
    });
  }

  private finishFromExit(exitCode: number | null): void {
    if (this.settled) return;
    if (this.pending.trim()) this.consumeLine(this.pending);
    this.pending = "";
    this.settled = true;
    if (this.cancelRequested) this.status = "cancelled";
    else if (exitCode === 0 && this.terminalStatus === "completed") this.status = "completed";
    else this.status = "failed";
    const stderr = this.stderr.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
    const error = this.status === "failed"
      ? stderr || (this.terminalStatus === "failed" ? "The provider reported a failed run" : "The provider stream ended without a successful terminal event")
      : undefined;
    this.resolveCompletion({
      runId: this.runId,
      provider: this.provider,
      status: this.status,
      resultText: this.resultText,
      error,
      usage: this.usage,
      exitCode,
    });
  }
}

export class NativeCliRunner implements ProviderRunner {
  private readonly discovery: Pick<ProviderDiscovery, "scan">;
  private readonly resolveCwd: (request: ProviderRunRequest) => string;
  private readonly spawnProcess: ProcessSpawner;
  private readonly platform: NodeJS.Platform;
  private readonly comSpec: string | undefined;
  private readonly killProcessTree: ProcessTreeKiller;

  constructor(options: NativeCliRunnerOptions) {
    this.discovery = options.discovery;
    this.resolveCwd = options.resolveCwd ?? (() => process.cwd());
    this.spawnProcess = options.spawnProcess ?? ((command, args, spawnOptions) => spawn(command, args, spawnOptions));
    this.platform = options.platform ?? process.platform;
    this.comSpec = options.comSpec ?? join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe");
    this.killProcessTree = options.killProcessTree ?? ((pid) => {
      const taskkill = join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
      spawn(taskkill, ["/pid", String(pid), "/t", "/f"], { windowsHide: true, shell: false, stdio: "ignore" }).unref();
    });
  }

  async start(request: ProviderRunRequest): Promise<RunHandle> {
    if (Buffer.byteLength(request.prompt, "utf8") > MAX_PROMPT) {
      throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: "The provider prompt exceeds the 1 MiB safety limit", operation: "runs.start" });
    }
    const statuses = await this.discovery.scan(request.provider);
    const status: ProviderSummary | undefined = statuses[0];
    if (!status || status.provider !== request.provider || status.status !== "ready" || !status.executablePath) {
      throw new BookWriterError({
        code: status?.status === "not_installed" ? "PROVIDER_NOT_INSTALLED" : "PROVIDER_NOT_READY",
        message: status?.message || `${request.provider} is not ready`,
        operation: "runs.start",
      });
    }
    const args = providerArguments(request);
    const invocation = providerInvocation(status.executablePath, args, this.platform, this.comSpec);
    const cwd = resolve(this.resolveCwd(request));
    const child = this.spawnProcess(invocation.command, invocation.args, {
      cwd,
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    // Cancellation must reap descendants, not just the process we spawned. A
    // command shim makes that obvious because cmd.exe is the direct child, but a
    // provider distributed as a plain .exe can equally spawn its own helpers, and
    // child.kill() would strand them. Tree-kill covers every win32 spawn.
    const needsTreeKill = this.platform === "win32";
    return new NativeCliRunHandle(request, child, needsTreeKill ? this.killProcessTree : undefined);
  }
}
