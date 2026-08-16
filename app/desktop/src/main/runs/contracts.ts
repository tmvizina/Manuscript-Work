import type {
  ExecutionProvider,
  RunEvent as CoreRunEvent,
  RunResult as CoreRunResult,
  RunUsage as CoreRunUsage,
} from "@book-writer/core";
import type {
  RunAccepted,
  RunCancelResult,
  RunEvent,
  RunEventDelivery,
  RunRecord,
  RunRequest,
  RunSubscribeRequest,
  RunSubscriptionAccepted,
  RunUnsubscribeResult,
} from "../../shared/contracts.js";

/** A value may be supplied by a synchronous test double or an async store. */
export type MaybePromise<T> = T | Promise<T>;

/**
 * The request handed to a provider runner. The manager owns the run id so a
 * provider cannot accidentally publish events into a different run.
 */
export interface ProviderRunRequest extends RunRequest {
  runId: string;
}

/** Provider result errors are deliberately unknown at this seam. */
export interface ProviderRunResult {
  runId?: string;
  provider?: ExecutionProvider;
  status: "completed" | "failed" | "cancelled";
  resultText?: string;
  error?: unknown;
  usage?: CoreRunUsage;
  exitCode?: number | null;
  startedAt?: string;
  finishedAt?: string;
}

/**
 * A provider process/session owned by one RunManager. Either an event
 * subscription or an async event stream is sufficient; adapters may expose
 * both, but the manager prefers subscribe so early events are not lost.
 */
export interface RunHandle {
  readonly runId: string;
  readonly provider: ExecutionProvider;
  readonly request?: ProviderRunRequest;
  readonly status?: "queued" | "starting" | "running" | "completed" | "failed" | "cancelled";
  readonly events?: AsyncIterable<CoreRunEvent | unknown>;
  subscribe?: (listener: (event: CoreRunEvent | unknown) => void) => () => void;
  cancel(reason?: string): MaybePromise<boolean>;
  wait(): Promise<ProviderRunResult | CoreRunResult>;
}

/** Native/provider adapter injected into the desktop run service. */
export interface ProviderRunner {
  start(request: ProviderRunRequest): MaybePromise<RunHandle>;
}

/** Input supplied to persistence; it is intentionally independent of DB. */
export interface RunCreateInput {
  runId: string;
  projectId?: string | null;
  provider: ExecutionProvider;
  model?: string;
  skillId?: string | null;
  variant: "base" | "rag";
  permissionMode: "default" | "acceptEdits" | "plan";
  prompt: string;
  createdAt: string;
}

export interface RunFinishInput {
  status: "completed" | "failed" | "cancelled";
  resultText?: string;
  error?: string | null;
  usage?: CoreRunUsage;
  startedAt?: string;
  finishedAt?: string;
}

/**
 * Persistence is an injected seam. The native runtime can adapt these calls
 * to SQLite without creating a runtime -> manager import cycle.
 */
export interface RunPersistence {
  createRun(input: RunCreateInput): MaybePromise<RunRecord>;
  getRun(runId: string): MaybePromise<RunRecord | null>;
  markRunStarted?(runId: string, startedAt?: string): MaybePromise<void | RunRecord>;
  finishRun?(runId: string, input: RunFinishInput): MaybePromise<void | RunRecord>;
}

export type RunIdFactory = (kind: "run" | "subscription") => string;
export type Clock = () => string;

export interface RunManagerOptions {
  runner: ProviderRunner;
  persistence: RunPersistence;
  idFactory?: RunIdFactory;
  clock?: Clock;
  /** A smaller value is useful for deterministic tests; never exceeds the IPC limit. */
  replayLimit?: number;
}

/** The service shape consumed by DesktopRuntime for the run operations. */
export interface RunService {
  startRun(request: RunRequest): MaybePromise<RunAccepted>;
  getRun(runId: string): MaybePromise<RunRecord>;
  cancelRun(runId: string): MaybePromise<RunCancelResult>;
  subscribeRun(
    request: RunSubscribeRequest,
    deliver: (delivery: RunEventDelivery) => void,
  ): MaybePromise<RunSubscriptionAccepted>;
  unsubscribeRun(subscriptionId: string): MaybePromise<RunUnsubscribeResult>;
}

export type DesktopRunEvent = RunEvent;
