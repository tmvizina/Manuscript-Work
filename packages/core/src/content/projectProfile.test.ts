import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { loadProjectProfile, ProjectProfileError, scaffoldProjectProfile } from "./projectProfile.js";

const roots: string[] = [];
function projectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "book-writer-profile-"));
  roots.push(root);
  return root;
}
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

describe("project profiles", () => {
  it("keeps projects without configuration on the fantasy profile", () => {
    const loaded = loadProjectProfile(projectRoot());
    expect(loaded.source).toBe("default");
    expect(loaded.config).toMatchObject({ profile: "fantasy", memoryLabel: "World" });
  });

  it("scaffolds the fishing Knowledge Base without overwriting files", () => {
    const root = projectRoot();
    mkdirSync(join(root, "world", "author"), { recursive: true });
    writeFileSync(join(root, "world", "author", "voice-profile.md"), "brother's voice", "utf-8");
    const result = scaffoldProjectProfile(root, { profile: "nonfiction", preset: "fly-night-fishing" });
    expect(result.config.memoryLabel).toBe("Knowledge Base");
    expect(result.created).toContain(".book-writer/project.json");
    expect(result.preserved).toContain("world/author/voice-profile.md");
    expect(readFileSync(join(root, "world", "author", "voice-profile.md"), "utf-8")).toBe("brother's voice");
    expect(loadProjectProfile(root).config).toMatchObject({ profile: "nonfiction", preset: "fly-night-fishing", claimsPolicy: "experience-led" });
  });

  it("rejects malformed, unknown, and conflicting configuration", () => {
    const root = projectRoot();
    mkdirSync(join(root, ".book-writer"));
    writeFileSync(join(root, ".book-writer", "project.json"), "{}", "utf-8");
    expect(() => loadProjectProfile(root)).toThrow(ProjectProfileError);
    writeFileSync(join(root, ".book-writer", "project.json"), JSON.stringify({ schemaVersion: 1, profile: "nonfiction", preset: "unknown", editorialMode: "practical-narrative", claimsPolicy: "experience-led", memoryRoot: "world", memoryLabel: "Knowledge Base" }), "utf-8");
    expect(() => loadProjectProfile(root)).toThrow("Unsupported nonfiction preset");
  });

  it("will not replace an existing project profile with a different preset", () => {
    const root = projectRoot();
    scaffoldProjectProfile(root, { profile: "fantasy" });
    expect(() => scaffoldProjectProfile(root, { profile: "nonfiction", preset: "fly-night-fishing" })).toThrow("different profile or preset");
  });

  it("does not scaffold through a symlinked world directory", () => {
    const root = projectRoot();
    const outside = projectRoot();
    try { symlinkSync(outside, join(root, "world"), "junction"); }
    catch { return; }
    expect(() => scaffoldProjectProfile(root, { profile: "nonfiction", preset: "fly-night-fishing" })).toThrow("physically contained");
  });
});
