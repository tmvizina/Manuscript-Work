import { randomUUID } from "node:crypto";
import {
  RUN_REPLAY_LIMIT,
  type ExecutionProvider,
  type RunAccepted,
  type RunCancelResult,
  type RunEvent,
  type RunEventDelivery,
  type RunRecord,
  type RunRequest,
  type RunStatus,
  type RunSubscribeRequest,
  type RunSubscriptionAccepted,
  type RunUnsubscribeResult,
} from "../../shared/contracts.js";
import { BookWriterError, IPC_ERROR_CODES } from "../../shared/errors.js";
import { cloneDesktopEvent, providerErrorMessage, sanitizeProviderEvent } from "./sanitize.js";
import type {
  ProviderRunRequest,
  ProviderRunResult,
  ProviderRunner,
  RunCreateInput,
  RunFinishInput,
  RunHandle,
  RunManagerOptions,
  RunPersistence,
  RunService,
} from "./contracts.js";

interface SubscriptionState {
  readonly subscriptionId: string;
  readonly runId: string;
  readonly afterSequence: number;
  readonly deliver: (delivery: RunEventDelivery) => void;
  ready: boolean;
  pending: RunEvent[];
}

interface RunState {
  readonly runId: string;
  readonly provider: ExecutionProvider;
  readonly request: RunRequest;
  readonly replay: RunEvent[];
  readonly subscriptions: Set<string>;
  nextSequence: number;
  handle?: RunHandle;
  stopProviderEvents?: () => void;
  waitStarted: boolean;
  finalized: boolean;
  seenTerminal: "completed" | "failed" | "cancelled" | null;
  cancelRequested: boolean;
  resultText?: string;
  error?: string;
}

interface ActiveRun {
  readonly state: RunState;
  readonly handle: RunHandle;
}

function defaultIdFactory(kind: "run" | "subscription"): string {
  return `${kind}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function defaultClock(): string {
  return new Date().toISOString();
}

function asStatus(value: unknown): RunStatus {
  if (value === "completed" || value === "failed" || value === "cancelled") return value;
  if (value === "running" || value === "starting" || value === "queued") return value;
  return "queued";
}

function acceptedStatus(value: unknown): RunAccepted["status"] {
  const status = asStatus(value);
  return status === "starting" || status === "running" ? status : "queued";
}

function isTerminalStatus(value: unknown): value is "completed" | "failed" | "cancelled" {
  return value === "completed" || value === "failed" || value === "cancelled";
}

function notFound(runId: string, operation: string): never {
  throw new BookWriterError({
    code: IPC_ERROR_CODES.notFound,
    message: `Run ${runId} was not found`,
    operation,
  });
}

function invalidState(message: string, operation: string): never {
  throw new BookWriterError({ code: IPC_ERROR_CODES.invalidResponse, message, operation });
}

function terminalType(status: "completed" | "failed" | "cancelled"): "run_completed" | "run_failed" | "stream_ended" {
  if (status === "completed") return "run_completed";
  if (status === "failed") return "run_failed";
  return "stream_ended";
}

/**
 * Owns provider handles and turns provider/core events into replayable,
 * renderer-safe desktop events. No concrete runtime or database is imported.
 */
export class RunManager implements RunService {
  private readonly runner: ProviderRunner;
  private readonly persistence: RunPersistence;
  private readonly idFactory: (kind: "run" | "subscription") => string;
  private readonly clock: () => string;
  private readonly replayLimit: number;
  private readonly states = new Map<string, RunState>();
  private readonly active = new Map<string, ActiveRun>();
  private readonly subscriptions = new Map<string, SubscriptionState>();
  private disposed = false;

  constructor(options: RunManagerOptions) {
    this.runner = options.runner;
    this.persistence = options.persistence;
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.clock = options.clock ?? defaultClock;
    const requestedLimit = options.replayLimit ?? RUN_REPLAY_LIMIT;
    this.replayLimit = Math.max(1, Math.min(RUN_REPLAY_LIMIT, Math.floor(requestedLimit)));
  }

  async startRun(request: RunRequest): Promise<RunAccepted> {
    this.ensureUsable("runs.start");
    const runId = this.nextId("run");
    const createdAt = this.clock();
    const createInput: RunCreateInput = {
      runId,
      projectId: request.projectId,
      provider: request.provider,
      ...(request.model === undefined ? {} : { model: request.model }),
      skillId: request.skillId,
      variant: request.variant ?? "base",
      permissionMode: request.permissionMode ?? "default",
      prompt: request.prompt,
      createdAt,
    };
    const persisted = await this.persistence.createRun(createInput);
    if (!persisted || persisted.runId !== runId) {
      invalidState("Run persistence returned a mismatched record", "runs.start");
    }

    const state: RunState = {
      runId,
      provider: request.provider,
      request: { ...request },
      replay: [],
      subscriptions: new Set(),
      nextSequence: 0,
      waitStarted: false,
      finalized: false,
      seenTerminal: null,
      cancelRequested: false,
    };
    this.states.set(runId, state);

    let handle: RunHandle;
    try {
      const providerRequest: ProviderRunRequest = { ...request, runId };
      handle = await this.runner.start(providerRequest);
      if (!handle || typeof handle.cancel !== "function" || typeof handle.wait !== "function") {
        invalidState("Provider runner returned an invalid run handle", "runs.start");
      }
      if (handle.runId !== runId || handle.provider !== request.provider) {
        invalidState("Provider runner returned a mismatched run handle", "runs.start");
      }
    } catch (error) {
      await this.finalizeStartFailure(state, error);
      if (error instanceof BookWriterError) throw error;
      throw new BookWriterError({
        code: "RUN_START_FAILED",
        message: "The provider could not start the run",
        operation: "runs.start",
      });
    }

    state.handle = handle;
    this.active.set(runId, { state, handle });
    this.attachProviderEvents(state, handle);
    if (handle.status === "running") void this.markStarted(state);
    this.observeCompletion(state, handle);
    return { runId, provider: request.provider, status: acceptedStatus(handle.status) };
  }

  async getRun(runId: string): Promise<RunRecord> {
    this.ensureUsable("runs.get");
    const record = await this.persistence.getRun(runId);
    if (!record) notFound(runId, "runs.get");
    return record;
  }

  async cancelRun(runId: string): Promise<RunCancelResult> {
    this.ensureUsable("runs.cancel");
    const active = this.active.get(runId);
    if (!active) {
      const record = await this.persistence.getRun(runId);
      if (!record) notFound(runId, "runs.cancel");
      return { runId, cancelled: false };
    }
    if (active.state.finalized || active.state.cancelRequested) return { runId, cancelled: false };
    let cancelled: boolean;
    try {
      cancelled = await active.handle.cancel("cancelled by desktop");
    } catch {
      cancelled = false;
    }
    if (!cancelled) return { runId, cancelled: false };
    active.state.cancelRequested = true;
    await this.finalize(active.state, {
      runId,
      provider: active.state.provider,
      status: "cancelled",
      error: "cancelled by desktop",
    });
    return { runId, cancelled: true };
  }

  async subscribeRun(
    request: RunSubscribeRequest,
    deliver: (delivery: RunEventDelivery) => void,
  ): Promise<RunSubscriptionAccepted> {
    this.ensureUsable("runs.subscribe");
    let state = this.states.get(request.runId);
    if (!state) {
      const record = await this.persistence.getRun(request.runId);
      if (!record) notFound(request.runId, "runs.subscribe");
      state = this.stateFromRecord(record);
      this.states.set(request.runId, state);
    }

    const subscriptionId = this.nextId("subscription");
    const afterSequence = Number.isSafeInteger(request.afterSequence) && (request.afterSequence as number) >= -1
      ? (request.afterSequence as number)
      : -1;
    const subscription: SubscriptionState = {
      subscriptionId,
      runId: request.runId,
      afterSequence,
      deliver,
      ready: false,
      pending: [],
    };
    this.subscriptions.set(subscriptionId, subscription);
    state.subscriptions.add(subscriptionId);

    // The subscription is live before the snapshot is taken. Provider events
    // arriving during this synchronous window are queued and de-duplicated
    // against the returned replay batch below.
    const replay = state.replay
      .filter((event) => event.sequence > afterSequence)
      .map(cloneDesktopEvent);
    const replaySequences = new Set(replay.map((event) => event.sequence));
    const replayCursor = replay.at(-1)?.sequence ?? afterSequence;
    const replayTruncated = state.replay.length > 0 && state.replay[0]!.sequence > afterSequence + 1;

    subscription.ready = true;
    const pending = subscription.pending;
    subscription.pending = [];
    for (const event of pending) {
      if (event.sequence <= afterSequence || replaySequences.has(event.sequence)) continue;
      this.deliver(subscription, event);
    }
    return {
      subscriptionId,
      runId: request.runId,
      replayCursor,
      replayTruncated,
      replay,
    };
  }

  async unsubscribeRun(subscriptionId: string): Promise<RunUnsubscribeResult> {
    this.ensureUsable("runs.unsubscribe");
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) return { subscriptionId, unsubscribed: false };
    this.subscriptions.delete(subscriptionId);
    const state = this.states.get(subscription.runId);
    state?.subscriptions.delete(subscriptionId);
    subscription.pending = [];
    subscription.ready = false;
    return { subscriptionId, unsubscribed: true };
  }

  /** Dispose all provider listeners/handles and prevent new operations. */
  async shutdown(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const active = [...this.active.values()];
    this.active.clear();
    for (const subscription of this.subscriptions.values()) {
      subscription.pending = [];
      subscription.ready = false;
    }
    this.subscriptions.clear();
    for (const { state, handle } of active) {
      state.stopProviderEvents?.();
      state.stopProviderEvents = undefined;
      let cancelled = false;
      try {
        cancelled = await handle.cancel("desktop shutdown");
      } catch {
        // Shutdown is best-effort; a dead provider is already cleaned up.
      }
      await this.finalize(state, {
        runId: state.runId,
        provider: state.provider,
        status: cancelled ? "cancelled" : "failed",
        error: cancelled ? "cancelled during desktop shutdown" : "interrupted by desktop shutdown",
      });
    }
    this.states.clear();
  }

  async dispose(): Promise<void> {
    return this.shutdown();
  }

  /** Alias used by runtime close hooks. */
  async close(): Promise<void> {
    return this.shutdown();
  }

  private ensureUsable(operation: string): void {
    if (this.disposed) {
      throw new BookWriterError({ code: IPC_ERROR_CODES.forbidden, message: "Run service has been disposed", operation });
    }
  }

  private nextId(kind: "run" | "subscription"): string {
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      const value = this.idFactory(kind);
      if (typeof value === "string" && value.trim() && (kind === "run" ? !this.states.has(value) : !this.subscriptions.has(value))) return value;
    }
    invalidState(`Unable to allocate a unique ${kind} id`, `runs.${kind === "run" ? "start" : "subscribe"}`);
  }

  private stateFromRecord(record: RunRecord): RunState {
    return {
      runId: record.runId,
      provider: record.provider,
      request: {
        provider: record.provider,
        prompt: record.prompt,
        projectId: record.projectId,
        skillId: record.skillId,
        variant: record.variant,
        ...(record.model === undefined ? {} : { model: record.model }),
      },
      replay: [],
      subscriptions: new Set(),
      nextSequence: 0,
      waitStarted: false,
      finalized: record.status === "completed" || record.status === "failed" || record.status === "cancelled",
      seenTerminal: null,
      cancelRequested: record.status === "cancelled",
      ...(record.resultText === undefined ? {} : { resultText: record.resultText }),
      ...(record.error === undefined ? {} : { error: record.error }),
    };
  }

  private attachProviderEvents(state: RunState, handle: RunHandle): void {
    if (handle.subscribe) {
      try {
        state.stopProviderEvents = handle.subscribe((event) => this.onProviderEvent(state, event));
      } catch (error) {
        void this.finalize(state, {
          runId: state.runId,
          provider: state.provider,
          status: "failed",
          error,
        });
      }
      return;
    }
    if (!handle.events) return;
    void this.consumeEvents(state, handle.events);
  }

  private async consumeEvents(state: RunState, events: AsyncIterable<unknown>): Promise<void> {
    try {
      for await (const event of events) this.onProviderEvent(state, event);
    } catch (error) {
      if (!state.finalized) {
        await this.finalize(state, {
          runId: state.runId,
          provider: state.provider,
          status: "failed",
          error,
        });
      }
    }
  }

  private onProviderEvent(state: RunState, input: unknown): void {
    if (this.disposed || state.finalized) return;
    this.appendEvent(state, input);
  }

  /** Append and fan out one event. Finalization uses this after ownership is released. */
  private appendEvent(state: RunState, input: unknown): void {
    if (!Number.isSafeInteger(state.nextSequence) || state.nextSequence > Number.MAX_SAFE_INTEGER - 1) {
      void this.finalize(state, {
        runId: state.runId,
        provider: state.provider,
        status: "failed",
        error: "run event sequence exhausted",
      });
      return;
    }
    const event = sanitizeProviderEvent(input, {
      runId: state.runId,
      provider: state.provider,
      sequence: state.nextSequence++,
    });
    state.replay.push(event);
    if (state.replay.length > this.replayLimit) state.replay.splice(0, state.replay.length - this.replayLimit);
    if (event.type === "run_completed") {
      state.seenTerminal = "completed";
      state.resultText = event.result;
    } else if (event.type === "run_failed") {
      state.seenTerminal = "failed";
      state.resultText = event.result;
      state.error = event.error?.message;
    }
    if (event.type === "run_started") void this.markStarted(state);
    for (const subscriptionId of state.subscriptions) {
      const subscription = this.subscriptions.get(subscriptionId);
      if (!subscription) continue;
      if (!subscription.ready) subscription.pending.push(event);
      else this.deliver(subscription, event);
    }
  }

  private deliver(subscription: SubscriptionState, event: RunEvent): void {
    if (!this.subscriptions.has(subscription.subscriptionId)) return;
    try {
      subscription.deliver({ subscriptionId: subscription.subscriptionId, event: cloneDesktopEvent(event) });
    } catch {
      // A renderer callback must not break delivery to other subscriptions.
    }
  }

  private async markStarted(state: RunState): Promise<void> {
    if (state.finalized || !this.persistence.markRunStarted) return;
    try {
      await this.persistence.markRunStarted(state.runId, this.clock());
    } catch {
      // Persistence failures cannot safely be sent to the renderer as a provider event.
    }
  }

  private observeCompletion(state: RunState, handle: RunHandle): void {
    if (state.waitStarted) return;
    state.waitStarted = true;
    void Promise.resolve().then(() => handle.wait()).then(
      (result) => this.finalize(state, this.normalizeResult(state, result)),
      (error) => this.finalize(state, {
        runId: state.runId,
        provider: state.provider,
        status: state.cancelRequested ? "cancelled" : "failed",
        error,
      }),
    ).catch(() => undefined);
  }

  private normalizeResult(state: RunState, result: ProviderRunResult): ProviderRunResult {
    const status = state.cancelRequested ? "cancelled" : isTerminalStatus(result.status) ? result.status : "failed";
    return {
      ...result,
      runId: state.runId,
      provider: state.provider,
      status,
      ...(result.resultText === undefined && state.resultText === undefined ? {} : { resultText: result.resultText ?? state.resultText }),
      ...(result.error === undefined && state.error === undefined ? {} : { error: result.error ?? state.error }),
    };
  }

  private async finalizeStartFailure(state: RunState, error: unknown): Promise<void> {
    await this.finalize(state, {
      runId: state.runId,
      provider: state.provider,
      status: "failed",
      error,
    });
  }

  private async finalize(state: RunState, result: ProviderRunResult): Promise<void> {
    if (state.finalized) return;
    state.finalized = true;
    this.active.delete(state.runId);
    state.stopProviderEvents?.();
    state.stopProviderEvents = undefined;
    const status = result.status;
    const resultText = result.resultText ?? state.resultText;
    const error = status === "failed" ? (result.error === undefined ? state.error : providerErrorMessage(result.error)) : undefined;
    const finishInput: RunFinishInput = {
      status,
      ...(resultText === undefined ? {} : { resultText }),
      ...(error === undefined ? {} : { error }),
      ...(result.usage === undefined ? {} : { usage: result.usage }),
      ...(result.startedAt === undefined ? {} : { startedAt: result.startedAt }),
      ...(result.finishedAt === undefined ? {} : { finishedAt: result.finishedAt }),
    };
    if (this.persistence.finishRun) {
      try {
        await this.persistence.finishRun(state.runId, finishInput);
      } catch {
        // Keep the in-memory handle ownership/disposal invariant even if a store fails.
      }
    }

    const eventStatus = status === "cancelled" ? "cancelled" : status;
    const hasMatchingTerminal =
      (eventStatus === "completed" && state.seenTerminal === "completed") ||
      (eventStatus === "failed" && state.seenTerminal === "failed") ||
      (eventStatus === "cancelled" && state.seenTerminal === "cancelled");
    if (!hasMatchingTerminal) {
      const input: Record<string, unknown> = {
        type: terminalType(eventStatus),
        ...(resultText === undefined ? {} : { result: resultText }),
        ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
        ...(status === "failed" ? { error: result.error ?? error } : {}),
        ...(status === "cancelled" ? { status: "cancelled" } : {}),
      };
      this.appendEvent(state, input);
    }
  }
}

export function createRunManager(options: RunManagerOptions): RunManager {
  return new RunManager(options);
}

/** A small deterministic persistence implementation for tests and prototypes. */
export class InMemoryRunPersistence implements RunPersistence {
  private readonly records = new Map<string, RunRecord>();

  createRun(input: RunCreateInput): RunRecord {
    const record: RunRecord = {
      runId: input.runId,
      projectId: input.projectId ?? null,
      provider: input.provider,
      ...(input.model === undefined ? {} : { model: input.model }),
      skillId: input.skillId ?? null,
      variant: input.variant,
      status: "queued",
      prompt: input.prompt,
      createdAt: input.createdAt,
    };
    this.records.set(input.runId, record);
    return record;
  }

  getRun(runId: string): RunRecord | null {
    const record = this.records.get(runId);
    return record ? { ...record, ...(record.usage ? { usage: { ...record.usage } } : {}) } : null;
  }

  markRunStarted(runId: string, startedAt = new Date().toISOString()): void {
    const record = this.records.get(runId);
    if (!record || record.status === "completed" || record.status === "failed" || record.status === "cancelled") return;
    record.status = "running";
    record.startedAt = startedAt;
  }

  finishRun(runId: string, input: RunFinishInput): void {
    const record = this.records.get(runId);
    if (!record) return;
    record.status = input.status;
    if (input.resultText !== undefined) record.resultText = input.resultText;
    if (input.error !== undefined) record.error = input.error ?? undefined;
    if (input.usage !== undefined) record.usage = { ...input.usage };
    if (input.startedAt !== undefined) record.startedAt = input.startedAt;
    record.finishedAt = input.finishedAt ?? new Date().toISOString();
  }
}
