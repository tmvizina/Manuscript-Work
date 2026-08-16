import { describe, expect, it } from "vitest";
import { createHttpTransport, type FetchLike } from "./http.js";

interface Call {
  input: RequestInfo | URL;
  init?: RequestInit;
}

function mockedFetch(...bodies: unknown[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  let index = 0;
  const fetch: FetchLike = async (input, init) => {
    calls.push({ input, init });
    const body = bodies[index++];
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetch, calls };
}

describe("HTTP transport", () => {
  it("keeps the current chapter endpoints and normalizes legacy rows", async () => {
    const mocked = mockedFetch({
      chapters: [
        {
          chapter_id: "book-1/Chapter 01 - Start.txt",
          book: "book-1",
          rel_path: "chapters/Chapter 01 - Start.txt",
          number: 1,
          title: "Start",
          word_count: 12,
          active: 1,
          file_mtime: "2026-08-16T00:00:00.000Z",
        },
      ],
    }, {
      chapter_id: "book-1/Chapter 01 - Start.txt",
      book: "book-1",
      rel_path: "chapters/Chapter 01 - Start.txt",
      number: 1,
      title: "Start",
      word_count: 12,
      active: 1,
      text: "A dragon wakes.",
      sha256: "hash",
      synced_at: "2026-08-16T00:01:00.000Z",
    }, { ok: true }, { chapters: [] });
    const transport = createHttpTransport({ fetch: mocked.fetch });

    await expect(transport.content.listChapters("legacy")).resolves.toEqual([
      {
        chapterId: "book-1/Chapter 01 - Start.txt",
        book: "book-1",
        relPath: "chapters/Chapter 01 - Start.txt",
        number: 1,
        title: "Start",
        wordCount: 12,
        active: true,
        updatedAt: "2026-08-16T00:00:00.000Z",
      },
    ]);
    await expect(transport.content.getChapter("legacy", "book-1/Chapter 01 - Start.txt", { fresh: true })).resolves.toMatchObject({
      chapterId: "book-1/Chapter 01 - Start.txt",
      text: "A dragon wakes.",
      sha256: "hash",
      updatedAt: "2026-08-16T00:01:00.000Z",
    });
    await expect(transport.chapters.refresh("legacy")).resolves.toEqual([]);
    expect(mocked.calls.map((call) => String(call.input))).toEqual([
      "/api/chapters",
      "/api/chapters/book-1%2FChapter%2001%20-%20Start.txt?fresh=1",
      "/api/chapters/sync",
      "/api/chapters",
    ]);
    expect(mocked.calls[2]?.init).toMatchObject({ method: "POST" });
  });

  it("flattens the grouped world endpoint and preserves rendered Markdown", async () => {
    const mocked = mockedFetch(
      { exists: true, groups: [{ dir: "characters", files: [{ rel_path: "characters/Aria.md", name: "Aria", ext: ".md" }] }] },
      { rel_path: "characters/Aria.md", mtime: "2026-08-16T00:00:00.000Z", bytes: 20, kind: "md", html: "<p>Aria</p>" },
    );
    const transport = createHttpTransport({ fetch: mocked.fetch });

    await expect(transport.content.listWorld("legacy")).resolves.toEqual([
      { documentId: "world:characters/Aria.md", relPath: "characters/Aria.md", title: "Aria" },
    ]);
    await expect(transport.content.getWorld("legacy", "characters/Aria.md")).resolves.toEqual({
      documentId: "world:characters/Aria.md",
      relPath: "characters/Aria.md",
      updatedAt: "2026-08-16T00:00:00.000Z",
      text: "",
      html: "<p>Aria</p>",
      kind: "md",
      bytes: 20,
    });
    expect(String(mocked.calls[1]?.input)).toBe("/api/world/file?path=characters%2FAria.md");
  });

  it("does not misrepresent semantic RAG as literal project search", async () => {
    const mocked = mockedFetch();
    const transport = createHttpTransport({ fetch: mocked.fetch });
    await expect(transport.search.query({ projectId: "legacy", query: "dragon", limit: 3 })).rejects.toMatchObject({
      code: "FEATURE_UNAVAILABLE",
      operation: "search.query",
    });
    expect(mocked.calls).toHaveLength(0);
  });

  it("retains a synthetic default project for the pre-project HTTP server", async () => {
    const mocked = mockedFetch({ manuscript_root: "C:/manuscript" });
    const transport = createHttpTransport({ fetch: mocked.fetch });
    await expect(transport.projects.list()).resolves.toEqual([
      { projectId: "legacy", name: "Book Writer", rootPath: "C:/manuscript", active: true },
    ]);
    expect(String(mocked.calls[0]?.input)).toBe("/api/health");
  });

  it("reports project settings as an explicit desktop-only capability", async () => {
    const transport = createHttpTransport({ fetch: mockedFetch().fetch });
    await expect(transport.settings.get("legacy", "preferredProvider")).rejects.toMatchObject({ code: "FEATURE_UNAVAILABLE", operation: "settings.get" });
  });
});
