import { describe, expect, it, vi } from "vitest";
import { createBufferedBatch, DEFAULT_STREAM_UPDATE_INTERVAL_MS } from "./bufferedBatch";

describe("createBufferedBatch", () => {
  it("keeps event order while coalescing updates within the interval", () => {
    vi.useFakeTimers();
    try {
      const updates: string[][] = [];
      const batch = createBufferedBatch<string>((values) => updates.push([...values]));

      batch.push("one");
      batch.push("two");
      expect(updates).toEqual([]);

      vi.advanceTimersByTime(DEFAULT_STREAM_UPDATE_INTERVAL_MS - 1);
      expect(updates).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(updates).toEqual([["one", "two"]]);

      batch.push("three");
      vi.advanceTimersByTime(DEFAULT_STREAM_UPDATE_INTERVAL_MS);
      expect(updates).toEqual([["one", "two"], ["three"]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushes immediately and does not deliver after disposal", () => {
    const updates: number[][] = [];
    const batch = createBufferedBatch<number>((values) => updates.push([...values]), { intervalMs: 100 });

    batch.push(1);
    batch.push(2);
    batch.flush();
    expect(updates).toEqual([[1, 2]]);

    batch.push(3);
    batch.dispose();
    batch.flush();
    expect(updates).toEqual([[1, 2]]);
  });

  it("bounds a burst even when the scheduler has not had a chance to run", () => {
    vi.useFakeTimers();
    const updates: number[][] = [];
    try {
      const batch = createBufferedBatch<number>((values) => updates.push([...values]), { intervalMs: 100, maxBatchSize: 2 });

      batch.push(1);
      vi.advanceTimersByTime(50);
      batch.push(2);
      expect(updates).toEqual([[1, 2]]);

      batch.push(3);
      vi.advanceTimersByTime(50);
      // The timer created by the first value was cancelled by the size flush;
      // the third value still has half of its own interval remaining.
      expect(updates).toEqual([[1, 2]]);
      vi.advanceTimersByTime(50);
      expect(updates).toEqual([[1, 2], [3]]);
    } finally {
      vi.useRealTimers();
    }
  });
});
