/**
 * Collect high-frequency stream values and deliver them at a bounded rate.
 *
 * Provider streams can emit one event for every token. Updating React state
 * for each event makes the renderer do a full reconciliation for every
 * token, even though a human cannot see updates that quickly. This small
 * scheduler keeps event ordering and never drops values while limiting the
 * number of state updates made by a consumer.
 */

export const DEFAULT_STREAM_UPDATE_INTERVAL_MS = 50;
export const DEFAULT_STREAM_MAX_BATCH_SIZE = 256;

type Timer = ReturnType<typeof setTimeout>;
type Schedule = (callback: () => void, delayMs: number) => Timer;
type Cancel = (timer: Timer) => void;

export interface BufferedBatch<T> {
  /** Queue one value for the next scheduled flush. */
  push(value: T): void;
  /** Deliver queued values immediately, if any. */
  flush(): void;
  /** Stop future delivery and discard queued values. */
  dispose(): void;
}

export interface BufferedBatchOptions {
  intervalMs?: number;
  /** Flush synchronously when a burst reaches this size. */
  maxBatchSize?: number;
  schedule?: Schedule;
  cancel?: Cancel;
}

/**
 * Create a bounded-rate batcher for event streams.
 *
 * `schedule` and `cancel` are injectable so this primitive stays deterministic
 * in tests and does not require a browser scheduler. The default uses a short
 * timeout rather than requestAnimationFrame because output should continue to
 * drain when the renderer is not currently visible.
 */
export function createBufferedBatch<T>(
  onFlush: (values: readonly T[]) => void,
  options: BufferedBatchOptions = {},
): BufferedBatch<T> {
  const intervalMs = Number.isFinite(options.intervalMs)
    ? Math.max(0, options.intervalMs as number)
    : DEFAULT_STREAM_UPDATE_INTERVAL_MS;
  const maxBatchSize = Number.isFinite(options.maxBatchSize)
    ? Math.max(1, Math.floor(options.maxBatchSize as number))
    : DEFAULT_STREAM_MAX_BATCH_SIZE;
  const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancel = options.cancel ?? ((timer) => clearTimeout(timer));
  let pending: T[] = [];
  let timer: Timer | undefined;
  let disposed = false;

  const flush = () => {
    timer = undefined;
    if (disposed || pending.length === 0) return;
    const values = pending;
    pending = [];
    onFlush(values);
  };

  const flushNow = () => {
    if (timer !== undefined) {
      cancel(timer);
      timer = undefined;
    }
    flush();
  };

  return {
    push(value) {
      if (disposed) return;
      pending.push(value);
      if (pending.length >= maxBatchSize) {
        flushNow();
        return;
      }
      if (timer === undefined) timer = schedule(flush, intervalMs);
    },
    flush() {
      flushNow();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer !== undefined) cancel(timer);
      timer = undefined;
      pending = [];
    },
  };
}
