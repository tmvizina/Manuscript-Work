import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanChapterFiles } from "./chapters.js";
import { listHelpSections, readHelpSection, type HelpSectionDefinition } from "./help.js";
import { isPathInside, resolveInside, safeReviewPath, safeWorldPath } from "./paths.js";
import { scanProjectChapterFiles, syncProjectChapters } from "./projectChapters.js";
import { scanReviewDocs } from "./reviews.js";
import { readSkillMetadata } from "./skills.js";
import { listWorld, readWorldFile } from "./world.js";
import { createProject, listProjectChapters, openDb } from "../db/index.js";

const tempRoots: string[] = [];

function projectRoot(): string {
  const testRoot = join(process.cwd(), ".tmp-tests");
  mkdirSync(testRoot, { recursive: true });
  const root = mkdtempSync(join(testRoot, "book-writer-content-"));
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

describe("trusted project chapter content", () => {
  it("syncs decimal chapter numbers in deterministic order", () => {
    const root = projectRoot();
    mkdirSync(join(root, "chapters"), { recursive: true });
    for (const [name, text] of [
      ["Chapter 10 - Tenth.txt", "ten"],
      ["Chapter 2.5 - Interlude.txt", "interlude"],
      ["Chapter 2 - Second.txt", "two"],
    ]) {
      writeFileSync(join(root, "chapters", name), text, "utf8");
    }

    const db = openDb(":memory:");
    const project = createProject(db, { projectId: "project-decimal", name: "Decimal", rootPath: root });
    expect(scanProjectChapterFiles(project).map((file) => file.number)).toEqual([2, 2.5, 10]);
    expect(syncProjectChapters(db, project)).toMatchObject({ scanned: 3, added: 3 });
    expect(listProjectChapters(db, project.projectId).map((chapter) => chapter.number)).toEqual([2, 2.5, 10]);
    db.close();
  });

  it("deactivates stale rows without deleting their snapshots", () => {
    const root = projectRoot();
    const filename = "Chapter 1 - Arrival.txt";
    mkdirSync(join(root, "chapters"), { recursive: true });
    writeFileSync(join(root, "chapters", filename), "the arrival", "utf8");

    const db = openDb(":memory:");
    const project = createProject(db, { projectId: "project-stale", name: "Stale", rootPath: root });
    expect(syncProjectChapters(db, project)).toMatchObject({ scanned: 1, added: 1 });
    rmSync(join(root, "chapters", filename));

    expect(syncProjectChapters(db, project)).toMatchObject({ scanned: 0, deactivated: 1 });
    expect(listProjectChapters(db, project.projectId)).toHaveLength(0);
    expect(listProjectChapters(db, project.projectId, { includeInactive: true })[0]).toMatchObject({
      chapterId: `book-1/${filename}`,
      text: "the arrival",
      active: false,
    });
    db.close();
  });

  it("keeps chapter paths inside the trusted project root", () => {
    const root = projectRoot();
    const neighboringRoot = projectRoot();
    const filename = "Chapter 1 - In Scope.txt";
    mkdirSync(join(root, "chapters"), { recursive: true });
    mkdirSync(join(neighboringRoot, "chapters"), { recursive: true });
    writeFileSync(join(root, "chapters", filename), "inside", "utf8");
    writeFileSync(join(neighboringRoot, "chapters", filename), "outside", "utf8");

    const db = openDb(":memory:");
    const project = createProject(db, { projectId: "project-contained", name: "Contained", rootPath: root });
    expect(syncProjectChapters(db, project)).toMatchObject({ scanned: 1, added: 1 });
    expect(listProjectChapters(db, project.projectId)[0]).toMatchObject({
      relPath: `chapters/${filename}`,
      text: "inside",
    });
    db.close();
  });

  it("isolates colliding chapter IDs and leaves legacy chapters untouched", () => {
    const rootOne = projectRoot();
    const rootTwo = projectRoot();
    const filename = "Chapter 1 - Shared Title.txt";
    for (const [root, text] of [[rootOne, "first manuscript"], [rootTwo, "second manuscript"]]) {
      mkdirSync(join(root, "chapters"), { recursive: true });
      writeFileSync(join(root, "chapters", filename), text, "utf8");
    }

    const db = openDb(":memory:");
    const now = "2026-08-16T00:00:00Z";
    db.prepare(
      `INSERT INTO chapters(
        chapter_id, book, rel_path, number, title, text, sha256, word_count, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `book-1/${filename}`,
      "book-1",
      `chapters/${filename}`,
      1,
      "Shared Title",
      "legacy manuscript",
      "legacy-hash",
      2,
      now,
    );
    const projectOne = createProject(db, { projectId: "project-one", name: "One", rootPath: rootOne });
    const projectTwo = createProject(db, { projectId: "project-two", name: "Two", rootPath: rootTwo });
    syncProjectChapters(db, projectOne);
    syncProjectChapters(db, projectTwo);

    expect(listProjectChapters(db, projectOne.projectId)[0]?.text).toBe("first manuscript");
    expect(listProjectChapters(db, projectTwo.projectId)[0]?.text).toBe("second manuscript");
    expect(db.prepare("SELECT text FROM chapters WHERE chapter_id = ?").get(`book-1/${filename}`)).toMatchObject({
      text: "legacy manuscript",
    });
    db.close();
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
