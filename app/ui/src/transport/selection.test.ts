import { describe, expect, it } from "vitest";
import { isBookWriterReadOnlyBridge } from "./bridge.js";
import { createTransport } from "./index.js";
import type { BookWriterReadOnlyBridge } from "./bridge.js";

function bridge(): BookWriterReadOnlyBridge {
  return {
    projects: {
      list: async () => [],
      get: async () => null,
      open: async () => ({ projectId: "project-1", name: "Project", rootPath: "C:/project", active: true }),
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
    },
    search: { query: async () => [] },
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
