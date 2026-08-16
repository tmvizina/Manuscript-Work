import { describe, expect, it } from "vitest";
import { createElectronTransport } from "./electron.js";
import type { BookWriterReadOnlyBridge } from "./bridge.js";

function nativeBridge(): BookWriterReadOnlyBridge {
  return {
    projects: {
      list: async () => [{ projectId: "project-1", name: "Project", rootPath: "C:/project", active: true }],
      get: async () => ({ projectId: "project-1", name: "Project", rootPath: "C:/project", active: true, worldRoot: "C:/project/world" }),
      open: async () => ({ projectId: "project-1", name: "Project", rootPath: "C:/project", active: true }),
    },
    content: {
      listChapters: async (projectId) => [{ chapterId: `${projectId}:chapter-1`, book: "book-1", relPath: "chapters/one.txt", number: 1, title: "One", wordCount: 4, active: true }],
      getChapter: async (_projectId, chapterId) => ({ chapterId, book: "book-1", relPath: "chapters/one.txt", number: 1, title: "One", wordCount: 4, active: true, text: "text" }),
      listWorld: async () => [{ documentId: "world:one.md", relPath: "one.md", title: "One" }],
      getWorld: async (_projectId, relPath) => ({ documentId: `world:${relPath}`, relPath, title: "One", text: "# One" }),
    },
    search: {
      query: async () => [{ resultId: "world:one.md", scope: "world", relPath: "one.md", title: "One", snippet: "dragon", score: 1 }],
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
  });

  it("requires a project ID for native content and search", async () => {
    const transport = createElectronTransport(nativeBridge());
    await expect(transport.content.listChapters()).rejects.toMatchObject({ code: "INVALID_ARGUMENT", kind: "electron" });
    await expect(transport.search.query({ query: "dragon" })).rejects.toMatchObject({ code: "INVALID_ARGUMENT", kind: "electron" });
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
