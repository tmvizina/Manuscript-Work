import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanChapterFiles } from "./chapters.js";
import { listHelpSections, readHelpSection, type HelpSectionDefinition } from "./help.js";
import { isPathInside, resolveInside, safeReviewPath, safeWorldPath } from "./paths.js";
import { scanReviewDocs } from "./reviews.js";
import { readSkillMetadata } from "./skills.js";
import { listWorld, readWorldFile } from "./world.js";

const tempRoots: string[] = [];

function projectRoot(): string {
  const root = mkdtempSync(join(process.env.TEMP ?? process.env.TMP ?? ".", "book-writer-content-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("safe content paths", () => {
  it("allows descendants and rejects traversal", () => {
    const root = projectRoot();
    expect(isPathInside(root, join(root, "world", "characters.md"))).toBe(true);
    expect(resolveInside(root, "world/characters.md")).toBe(join(root, "world", "characters.md"));
    expect(resolveInside(root, "../outside.txt")).toBeNull();
    expect(safeWorldPath(root, "../outside.txt")).toBeNull();
    expect(safeReviewPath(root, "reviews/../outside.md")).toBeNull();
  });
});

describe("chapter content", () => {
  it("preserves chapter IDs and snapshots source text", () => {
    const root = projectRoot();
    const chapter = "Chapter 01 - A Bell in the Orchard.txt";
    const text = "A bell answered from the orchard.";
    mkdirSync(join(root, "chapters"), { recursive: true });
    writeFileSync(join(root, "chapters", chapter), text, "utf8");

    const [record] = scanChapterFiles(root);
    expect(record.chapter_id).toBe(`book-1/${chapter}`);
    expect(record.title).toBe("A Bell in the Orchard");
    expect(record.number).toBe(1);
    expect(record.text).toBe(text);
    expect(record.sha256).toBe(createHash("sha256").update(text).digest("hex"));
  });
});

describe("skill content", () => {
  it("reads frontmatter and detects the RAG variant", () => {
    const root = projectRoot();
    mkdirSync(join(root, "skills", "demo"), { recursive: true });
    mkdirSync(join(root, "skills-rag", "demo-rag"), { recursive: true });
    writeFileSync(
      join(root, "skills", "demo", "SKILL.md"),
      "---\ndescription: A demo skill\n---\n\n# Demo\n",
      "utf8",
    );
    writeFileSync(join(root, "skills-rag", "demo-rag", "SKILL.md"), "# Demo RAG\n", "utf8");
    const metadata = readSkillMetadata(
      { skill_id: "demo", display_name: "Demo", pipeline_order: 1, phase: "intake", blurb: "demo" },
      root,
    );
    expect(metadata.description).toBe("A demo skill");
    expect(metadata.has_rag_variant).toBe(1);
    expect(metadata.missing).toBe(false);
  });
});

describe("world and review content", () => {
  it("lists world files and safely reads JSON", () => {
    const root = projectRoot();
    mkdirSync(join(root, "world", "characters"), { recursive: true });
    writeFileSync(join(root, "world", "characters", "mira.json"), '{"name":"Mira"}', "utf8");
    const listing = listWorld(root);
    expect(listing.exists).toBe(true);
    expect(listing.groups[0].files[0].rel_path).toBe("characters/mira.json");
    expect(readWorldFile(root, "characters/mira.json")?.text).toContain('"name": "Mira"');
    expect(readWorldFile(root, "../world/characters/mira.json")).toBeNull();
  });

  it("classifies review documents and computes stable summary stats", () => {
    const root = projectRoot();
    mkdirSync(join(root, "reviews"), { recursive: true });
    mkdirSync(join(root, "editing-plan"), { recursive: true });
    writeFileSync(
      join(root, "reviews", "2026-08-15-review.md"),
      "# Review\n\n### RV-2026-08-15-001 — Finding\n**Severity:** High\n",
      "utf8",
    );
    writeFileSync(join(root, "editing-plan", "2026-08-15-plan.md"), "# Plan\n\n### EP-001\n**Effort:** M\n", "utf8");
    const docs = scanReviewDocs(root);
    expect(docs).toHaveLength(2);
    expect(docs.find((doc) => doc.kind === "review")?.stats).toMatchObject({ findings: 1 });
    expect(docs.find((doc) => doc.kind === "plan")?.stats).toMatchObject({ items: 1, effort: "M" });
  });
});

describe("help content", () => {
  it("resolves help files beneath the explicit repository root", () => {
    const root = projectRoot();
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "guide.md"), "# Guide\n", "utf8");
    const sections: HelpSectionDefinition[] = [
      { slug: "guide", title: "Guide", blurb: "A guide", mdFile: "docs/guide.md" },
      { slug: "external", title: "External", blurb: "Elsewhere", mdFile: null, externalPath: "/help/external" },
    ];
    expect(listHelpSections(root, sections)[0]).toMatchObject({ slug: "guide", external: null });
    expect(readHelpSection(root, sections, "guide")?.markdown).toBe("# Guide\n");
    expect(readHelpSection(root, [{ ...sections[0], mdFile: "../secret.md" }], "guide")).toBeNull();
  });
});
