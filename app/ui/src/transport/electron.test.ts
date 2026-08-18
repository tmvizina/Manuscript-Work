import { describe, expect, it } from "vitest";
import { createElectronTransport } from "./electron.js";
import type { BookWriterReadOnlyBridge } from "./bridge.js";

function nativeBridge(): BookWriterReadOnlyBridge {
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
  },
  providers: {
      list: async () => [{ provider: "claude", status: "ready", version: "claude 2.1.0", executablePath: "C:/Tools/claude.exe" }, { provider: "codex", status: "not_installed" }],
      status: async (provider) => [{ provider: provider ?? "claude", status: "ready" }],
      install: async (provider) => ({ provider, status: "opened_external", ok: true, installed: false }),
      auth: async (provider) => ({ provider, status: "authenticated", ok: true, authenticated: true }),
      cancelAuth: async (provider) => ({ provider, cancelled: true }),
    },
    projects: {
      list: async () => [{ projectId: "project-1", name: "Project", rootPath: "C:/project", active: true }],
      get: async () => ({ projectId: "project-1", name: "Project", rootPath: "C:/project", active: true, worldRoot: "C:/project/world" }),
      open: async () => ({ projectId: "project-1", name: "Project", rootPath: "C:/project", active: true }),
      import: async () => null,
    },
    content: {
      listChapters: async (projectId) => [{ chapterId: `${projectId}:chapter-1`, book: "book-1", relPath: "chapters/one.txt", number: 1, title: "One", wordCount: 4, active: true }],
      getChapter: async (_projectId, chapterId) => ({ chapterId, book: "book-1", relPath: "chapters/one.txt", number: 1, title: "One", wordCount: 4, active: true, text: "text" }),
      listWorld: async () => [{ documentId: "world:one.md", relPath: "one.md", title: "One" }],
      getWorld: async (_projectId, relPath) => ({ documentId: `world:${relPath}`, relPath, title: "One", text: "# One" }),
      listReviews: async () => [],
      getReview: async (_projectId, relPath) => ({ relPath, kind: "review", updatedAt: "2026-08-16T00:00:00.000Z", bytes: 4, text: "text" }),
    },
    search: {
      query: async () => [{ resultId: "world:one.md", scope: "world", relPath: "one.md", title: "One", snippet: "dragon", score: 1 }],
    },
    settings: {
      get: async (projectId, key) => ({ projectId, key, value: key === "preferredProvider" ? "codex" : "base", updatedAt: "2026-08-16T00:00:00.000Z" }),
      set: async (projectId, key, value) => ({ projectId, key, value, updatedAt: "2026-08-16T00:01:00.000Z" }),
    },
    runs: {
      start: async (request) => ({ runId: "run-1", provider: request.provider, status: "queued" }),
      list: async () => [{ runId: "run-1", projectId: "project-1", provider: "claude", skillId: "book-reviewer-v2", variant: "base", status: "completed", prompt: "review", createdAt: "2026-08-16T00:00:00.000Z" }],
      get: async (runId) => ({ runId, projectId: "project-1", provider: "claude", variant: "base", status: "completed", prompt: "review", createdAt: "2026-08-16T00:00:00.000Z" }),
      cancel: async (runId) => ({ runId, cancelled: true }),
      subscribe: async (runId) => ({ subscriptionId: "sub-1", runId, replayCursor: -1, replayTruncated: false }),
      unsubscribe: async (subscriptionId) => ({ subscriptionId, unsubscribed: true }),
    },
  };
}

describe("Electron transport", () => {
  it("adapts the native project/content/search calls without exposing Electron runtime objects", async () => {
    const bridge = nativeBridge();
    const transport = createElectronTransport(bridge);

    await expect(transport.projects.list()).resolves.toEqual([
      { projectId: "project-1", name: "Project", rootPath: "C:/project", active: true },
    ]);
    await expect(transport.providers.list()).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ provider: "claude", status: "ready" })]));
    await expect(transport.providers.install("codex", "online")).resolves.toMatchObject({ provider: "codex", status: "opened_external" });
    await expect(transport.providers.auth("claude")).resolves.toMatchObject({ provider: "claude", authenticated: true });
    await expect(transport.providers.cancelAuth("claude")).resolves.toEqual({ provider: "claude", cancelled: true });
    await expect(transport.projects.get("project-1")).resolves.toMatchObject({ worldRoot: "C:/project/world" });
    await expect(transport.content.listChapters("project-1")).resolves.toEqual([
      { chapterId: "project-1:chapter-1", book: "book-1", relPath: "chapters/one.txt", number: 1, title: "One", wordCount: 4, active: true },
    ]);
    await expect(transport.content.getWorld("project-1", "one.md")).resolves.toEqual({
      documentId: "world:one.md",
      relPath: "one.md",
      title: "One",
      text: "# One",
    });
    await expect(transport.chapters.refresh("project-1")).resolves.toHaveLength(1);
    await expect(transport.search.query({ projectId: "project-1", query: "dragon", scope: "world", limit: 2 })).resolves.toEqual([
      { resultId: "world:one.md", scope: "world", relPath: "one.md", title: "One", snippet: "dragon", score: 1 },
    ]);
    await expect(transport.settings.get("project-1", "preferredProvider")).resolves.toMatchObject({ value: "codex" });
    await expect(transport.settings.set("project-1", "runVariant", "rag")).resolves.toMatchObject({ key: "runVariant", value: "rag" });
    await expect(transport.runs.list({ projectId: "project-1" })).resolves.toHaveLength(1);
  });

  it("requires a project ID for native content and search", async () => {
    const transport = createElectronTransport(nativeBridge());
    await expect(transport.content.listChapters()).rejects.toMatchObject({ code: "INVALID_ARGUMENT", kind: "electron" });
    await expect(transport.search.query({ query: "dragon" })).rejects.toMatchObject({ code: "INVALID_ARGUMENT", kind: "electron" });
  });

  it("rescans chapters only for an explicitly fresh native read", async () => {
    const bridge = nativeBridge();
    let scans = 0;
    const listChapters = bridge.content.listChapters;
    bridge.content.listChapters = async (projectId) => {
      scans += 1;
      return listChapters(projectId);
    };
    const transport = createElectronTransport(bridge);

    await transport.content.getChapter("project-1", "chapter-1");
    expect(scans).toBe(0);
    await transport.content.getChapter("project-1", "chapter-1", { fresh: true });
    expect(scans).toBe(1);
  });

  it("turns malformed bridge responses into renderer-safe errors", async () => {
    const bridge = nativeBridge();
    bridge.content.listWorld = async () => [undefined as never];
    await expect(createElectronTransport(bridge).content.listWorld("project-1")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      operation: "content.listWorld",
      kind: "invalid_response",
    });
  });
});
