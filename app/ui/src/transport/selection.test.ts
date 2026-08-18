import { describe, expect, it } from "vitest";
import { isBookWriterReadOnlyBridge } from "./bridge.js";
import { createTransport } from "./index.js";
import type { BookWriterReadOnlyBridge } from "./bridge.js";

function bridge(): BookWriterReadOnlyBridge {
  return {
    help: {
    list: async () => [],
    get: async () => ({ slug: "commands", title: "Command Reference", format: "markdown" as const, text: "# Commands" }),
  },
  rag: {
    status: async () => ({ projectId: "p", status: "never_indexed", totalFiles: 0, totalChunks: 0, modelId: null, lastIndexedAt: null, lastError: null, available: false }),
    query: async () => ({ projectId: "p", query: "", k: 5, results: [] }),
    reindex: async () => ({ projectId: "p", status: "indexing" }),
    cancel: async () => ({ projectId: "p", status: "ready" }),
    subscribe: async () => ({ subscriptionId: "sub-1" }),
    unsubscribe: async () => ({ subscriptionId: "sub-1", released: true }),
    installModel: async () => ({ status: "installed" as const, message: "ok" }),
  },
  providers: { list: async () => [], status: async () => [], install: async (provider) => ({ provider, status: "opened_external" as const, ok: true, installed: false }), auth: async (provider) => ({ provider, status: "authenticated" as const, ok: true, authenticated: true }), cancelAuth: async (provider) => ({ provider, cancelled: true }) },
    projects: {
      list: async () => [],
      get: async () => null,
      open: async () => ({ projectId: "project-1", name: "Project", rootPath: "C:/project", active: true }),
      import: async () => null,
    },
    content: {
      listChapters: async () => [],
      getChapter: async () => ({
        chapterId: "chapter-1",
        book: "book-1",
        relPath: "chapters/Chapter 1 - Start.txt",
        number: 1,
        title: "Start",
        wordCount: 0,
        active: true,
        text: "",
      }),
      listWorld: async () => [],
      getWorld: async () => ({ documentId: "world:x", relPath: "x.md", text: "" }),
      reviewIdIndex: async () => [],
    listReviews: async () => [],
      getReview: async (_projectId, relPath) => ({ relPath, kind: "review", updatedAt: "2026-08-16T00:00:00.000Z", bytes: 0, text: "" }),
    },
    search: { query: async () => [] },
    settings: {
      get: async () => null,
      set: async (projectId, key, value) => ({ projectId, key, value, updatedAt: "2026-08-16T00:00:00.000Z" }),
    },
    runs: {
      start: async (request) => ({ runId: "run-1", provider: request.provider, status: "queued" }),
      list: async () => [],
      get: async (runId) => ({ runId, provider: "claude", variant: "base", status: "completed", prompt: "", createdAt: "2026-08-16T00:00:00.000Z" }),
      cancel: async (runId) => ({ runId, cancelled: false }),
      subscribe: async (runId) => ({ subscriptionId: "sub-1", runId, replayCursor: -1, replayTruncated: false }),
      unsubscribe: async (subscriptionId) => ({ subscriptionId, unsubscribed: true }),
    },
  };
}

describe("transport runtime selection", () => {
  it("selects Electron only when the complete read-only bridge is present", () => {
    const native = bridge();
    expect(isBookWriterReadOnlyBridge(native)).toBe(true);
    expect(createTransport({ root: { window: { bookWriter: native } }, http: { fetch: async () => new Response("{}") } }).mode).toBe("electron");
  });

  it("keeps ordinary browser globals on HTTP", () => {
    const fetch = async () => new Response(JSON.stringify({}));
    expect(createTransport({ root: { window: {} }, http: { fetch } }).mode).toBe("http");
    expect(isBookWriterReadOnlyBridge({ projects: { list: () => undefined } })).toBe(false);
  });

  it("does not select a partial or malformed bridge", () => {
    const partial = { projects: { list: () => Promise.resolve([]) }, content: {}, search: {} };
    expect(createTransport({ root: { bookWriter: partial }, http: { fetch: async () => new Response("{}") } }).mode).toBe("http");
  });
});
