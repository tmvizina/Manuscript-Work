import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SEARCH_LIMITS, SearchInputError, searchProject } from "./index.js";

const tempRoots: string[] = [];

function projectRoot(): string {
  const testRoot = join(process.cwd(), ".tmp-tests");
  mkdirSync(testRoot, { recursive: true });
  const root = mkdtempSync(join(testRoot, "book-writer-search-"));
  tempRoots.push(root);
  return root;
}

function put(root: string, relPath: string, text: string): void {
  const path = join(root, relPath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text, "utf8");
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("bounded project search", () => {
  it("rejects empty, oversized, invalid-scope, and over-limit requests", () => {
    const root = projectRoot();
    expect(() => searchProject(root, { query: "" })).toThrow(SearchInputError);
    expect(() => searchProject(root, { query: "   " })).toThrow(SearchInputError);
    expect(() => searchProject(root, { query: "x".repeat(SEARCH_LIMITS.maxQueryLength + 1) })).toThrow(
      `at most ${SEARCH_LIMITS.maxQueryLength}`,
    );
    expect(() => searchProject(root, { query: "x", scope: "nope" as never })).toThrow("scope is invalid");
    expect(() => searchProject(root, { query: "x", limit: SEARCH_LIMITS.maxResultLimit + 1 })).toThrow(
      `at most ${SEARCH_LIMITS.maxResultLimit}`,
    );
  });

  it("matches literal text in paths containing spaces and returns desktop-shaped results", () => {
    const root = projectRoot();
    put(root, "world/Characters With Spaces/notes.md", "# The [literal] note\nThe [literal] marker is here.");
    put(root, "world/regex.md", "This file has dots ... but not the requested token.");
    put(root, "reviews/2026-08-16-review.md", "# Review\nA [literal] finding.");

    const results = searchProject(root, { query: "[literal]", scope: "world" });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      scope: "world",
      relPath: "world/Characters With Spaces/notes.md",
      title: "The [literal] note",
      score: 2,
    });
    expect(results[0]?.snippet).toContain("[literal]");
    expect(results[0]?.resultId).toBe("world:world/Characters With Spaces/notes.md");
  });

  it("is deterministic, applies scope and result limits, and orders paths", () => {
    const root = projectRoot();
    put(root, "chapters/Chapter 02 - Second.txt", "dragon appears");
    put(root, "chapters/Chapter 01 - First.txt", "dragon appears");
    put(root, "world/dragons.md", "dragon appears");

    const request = { query: "dragon", scope: "all" as const, limit: 2 };
    const first = searchProject(root, request);
    const second = searchProject(root, request);
    expect(first).toEqual(second);
    expect(first.map((result) => result.relPath)).toEqual([
      "chapters/Chapter 01 - First.txt",
      "chapters/Chapter 02 - Second.txt",
    ]);
    expect(searchProject(root, { query: "dragon", scope: "world" }).map((result) => result.scope)).toEqual(["world"]);
  });

  it("does not follow symlinked files or directories outside the project root", () => {
    const root = projectRoot();
    const outside = projectRoot();
    put(outside, "secret.md", "dragon outside the project");
    mkdirSync(join(root, "world"), { recursive: true });

    try {
      symlinkSync(join(outside, "secret.md"), join(root, "world", "linked.md"), "file");
      symlinkSync(outside, join(root, "world", "linked-directory"), "junction");
    } catch {
      // Windows may deny symlink creation without Developer Mode. The regular
      // containment assertions below still run on those machines.
    }

    put(root, "world/inside.md", "dragon inside the project");
    const results = searchProject(root, { query: "dragon", scope: "world" });
    expect(results.map((result) => result.relPath)).toEqual(["world/inside.md"]);
    expect(results.every((result) => !result.relPath.includes("secret"))).toBe(true);
  });

  it("skips files over the bounded read size", () => {
    const root = projectRoot();
    put(root, "world/too-large.md", `dragon${"x".repeat(SEARCH_LIMITS.maxFileBytes)}`);
    put(root, "world/small.md", "dragon in a bounded file");
    expect(searchProject(root, { query: "dragon", scope: "world" }).map((result) => result.relPath)).toEqual([
      "world/small.md",
    ]);
  });
});
