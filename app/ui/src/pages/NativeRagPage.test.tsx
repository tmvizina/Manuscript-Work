import { describe, expect, it } from "vitest";
import { describeRagState } from "./NativeRagPage";
import type { RagProgressEvent, RagStatus } from "../transport";

function status(overrides: Partial<RagStatus> = {}): RagStatus {
  return {
    projectId: "p1",
    status: "ready",
    totalFiles: 3,
    totalChunks: 12,
    modelId: "test/model",
    lastIndexedAt: null,
    lastError: null,
    available: true,
    ...overrides,
  };
}

function progress(overrides: Partial<RagProgressEvent> = {}): RagProgressEvent {
  return {
    projectId: "p1",
    status: "indexing",
    filesTotal: 4,
    filesIndexed: 1,
    chunksEmbedded: 9,
    currentPath: "world/mira.md",
    error: null,
    ...overrides,
  };
}

describe("describeRagState", () => {
  it("reports a build without the model as unavailable and unbuildable", () => {
    const view = describeRagState(status({ available: false, status: "never_indexed", totalChunks: 0 }), null);

    expect(view.unavailable).toBe(true);
    expect(view.canQuery).toBe(false);
    expect(view.headline).toMatch(/Not included in this build/i);
  });

  it("offers to build a missing index and refuses queries until it exists", () => {
    const view = describeRagState(status({ status: "never_indexed", totalChunks: 0 }), null);

    expect(view.actionLabel).toBe("Build index");
    expect(view.canQuery).toBe(false);
    expect(view.headline).toMatch(/Not indexed yet/i);
  });

  it("shows live counts while indexing and offers to stop", () => {
    const view = describeRagState(status({ status: "indexing" }), progress());

    expect(view.indexing).toBe(true);
    expect(view.actionLabel).toBe("Stop indexing");
    expect(view.detail).toContain("1 of 4 files, 9 passages");
    expect(view.detail).toContain("world/mira.md");
  });

  it("keeps querying available during a rebuild of an existing index", () => {
    // Old vectors stay committed until each file's replacements are ready, so
    // a query mid-reindex is answerable rather than blocked.
    const view = describeRagState(status({ status: "indexing", totalChunks: 12 }), progress());

    expect(view.canQuery).toBe(true);
  });

  it("distinguishes a cancelled index and says it will continue", () => {
    const view = describeRagState(status({ status: "cancelled", totalChunks: 5 }), null);

    expect(view.headline).toMatch(/cancelled/i);
    expect(view.detail).toMatch(/continues where it left off/i);
    expect(view.canQuery).toBe(true);
  });

  it("surfaces a failure while keeping earlier passages searchable", () => {
    const view = describeRagState(status({ status: "failed", lastError: "embedder exploded", totalChunks: 7 }), null);

    expect(view.detail).toContain("embedder exploded");
    expect(view.detail).toMatch(/still searchable/i);
    expect(view.canQuery).toBe(true);
  });

  it("does not claim surviving results when a first index failed outright", () => {
    const view = describeRagState(status({ status: "failed", lastError: "boom", totalChunks: 0 }), null);

    expect(view.detail).not.toMatch(/still searchable/i);
    expect(view.canQuery).toBe(false);
  });

  it("reports a ready index with its passage count", () => {
    const view = describeRagState(status({ status: "ready", totalChunks: 12 }), null);

    expect(view.headline).toBe("Ready");
    expect(view.detail).toContain("12 passages indexed");
    expect(view.actionLabel).toBe("Rebuild index");
  });

  it("treats a terminal progress event as no longer indexing", () => {
    const view = describeRagState(status({ status: "ready", totalChunks: 12 }), progress({ status: "ready" }));

    expect(view.indexing).toBe(false);
  });
});
