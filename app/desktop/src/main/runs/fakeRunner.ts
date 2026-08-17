import type { ExecutionProvider } from "../../shared/contracts.js";
import type {
  ProviderRunRequest,
  ProviderRunResult,
  ProviderRunner,
  RunHandle,
} from "./contracts.js";

export interface FakeRunPlan {
  /** Events are queued until the manager attaches its listener. */
  events?: readonly unknown[];
  result?: ProviderRunResult;
  waitError?: unknown;
  cancelResult?: boolean;
  completeOnCancel?: boolean;
}

type EventListener = (event: unknown) => void;

/** A manually controlled provider handle used by deterministic tests. */
export class DeterministicFakeRunHandle implements RunHandle {
  readonly runId: string;
  readonly provider: ExecutionProvider;
  readonly request: ProviderRunRequest;
  status: "queued" | "starting" | "running" | "completed" | "failed" | "cancelled" = "queued";
  cancelCalls = 0;
  private readonly listeners = new Set<EventListener>();
  private queuedEvents: unknown[];
  private settled = false;
  private readonly plan: FakeRunPlan;
  private readonly completion: Promise<ProviderRunResult>;
  private resolveCompletion!: (result: ProviderRunResult) => void;
  private rejectCompletion!: (error: unknown) => void;

  constructor(request: ProviderRunRequest, plan: FakeRunPlan = {}) {
    this.runId = request.runId;
    this.provider = request.provider;
    this.request = request;
    this.plan = plan;
    this.queuedEvents = [...(plan.events ?? [])];
    this.completion = new Promise<ProviderRunResult>((resolve, reject) => {
      this.resolveCompletion = resolve;
      this.rejectCompletion = reject;
    });
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    const queued = this.queuedEvents;
    this.queuedEvents = [];
    for (const event of queued) listener(event);
    return () => this.listeners.delete(listener);
  }

  emit(event: unknown): void {
    if (this.listeners.size === 0) {
      this.queuedEvents.push(event);
      return;
    }
    for (const listener of [...this.listeners]) listener(event);
  }

  emitEvent(event: unknown): void {
    this.emit(event);
  }

  complete(result: Partial<ProviderRunResult> = {}): void {
    if (this.settled) return;
    this.settled = true;
    this.status = "completed";
    this.resolveCompletion({
      runId: this.runId,
      provider: this.provider,
      status: "completed",
      ...this.plan.result,
      ...result,
    });
  }

  resolve(result: Partial<ProviderRunResult> = {}): void {
    this.complete(result);
  }

  fail(error: unknown = "fake provider failure", result: Partial<ProviderRunResult> = {}): void {
    if (this.settled) return;
    this.settled = true;
    this.status = "failed";
    this.resolveCompletion({
      runId: this.runId,
      provider: this.provider,
      status: "failed",
      error,
      ...this.plan.result,
      ...result,
    });
  }

  reject(error: unknown): void {
    if (this.settled) return;
    this.settled = true;
    this.status = "failed";
    this.rejectCompletion(error);
  }

  rejectWith(error: unknown): void {
    this.reject(error);
  }

  async cancel(_reason?: string): Promise<boolean> {
    this.cancelCalls += 1;
    const accepted = this.plan.cancelResult ?? true;
    if (accepted && this.plan.completeOnCancel) {
      this.settled = true;
      this.status = "cancelled";
      this.resolveCompletion({ runId: this.runId, provider: this.provider, status: "cancelled" });
    }
    return accepted;
  }

  wait(): Promise<ProviderRunResult> {
    if (this.plan.waitError !== undefined) return Promise.reject(this.plan.waitError);
    return this.completion;
  }
}

/**
 * Deterministic fake runner. Plans are consumed in start order; callers can
 * emit, complete, fail, or cancel each returned handle explicitly.
 */
export class DeterministicFakeRunner implements ProviderRunner {
  readonly starts: ProviderRunRequest[] = [];
  readonly handles = new Map<string, DeterministicFakeRunHandle>();
  private readonly plans: FakeRunPlan[];

  constructor(plans: readonly FakeRunPlan[] | FakeRunPlan = []) {
    this.plans = Array.isArray(plans) ? [...plans] : [plans];
  }

  enqueue(plan: FakeRunPlan = {}): void {
    this.plans.push(plan);
  }

  start(request: ProviderRunRequest): DeterministicFakeRunHandle {
    const handle = new DeterministicFakeRunHandle(request, this.plans.shift() ?? {});
    this.starts.push({ ...request });
    this.handles.set(request.runId, handle);
    return handle;
  }

  handle(runId: string): DeterministicFakeRunHandle {
    const handle = this.handles.get(runId);
    if (!handle) throw new Error(`No fake handle for ${runId}`);
    return handle;
  }

  emit(runId: string, event: unknown): void {
    this.handle(runId).emit(event);
  }

  complete(runId: string, result: Partial<ProviderRunResult> = {}): void {
    this.handle(runId).complete(result);
  }

  fail(runId: string, error?: unknown, result: Partial<ProviderRunResult> = {}): void {
    this.handle(runId).fail(error, result);
  }
}

/** Short names make tests/readers less noisy. */
export const FakeRunHandle = DeterministicFakeRunHandle;
export const FakeProviderRunner = DeterministicFakeRunner;
export const FakeRunner = DeterministicFakeRunner;
