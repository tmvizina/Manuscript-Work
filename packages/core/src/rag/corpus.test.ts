import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProject, openDb } from "../db/index.js";
import { chunkRagFile, scanRagCorpusFiles, syncRagCorpusFiles } from "./corpus.js";
import { replaceRagFileChunks } from "./store.js";

const tempRoots: string[] = [];

function projectRoot(): string {
  const testRoot = join(process.cwd(), ".tmp-tests");
  mkdirSync(testRoot, { recursive: true });
  const root = mkdtempSync(join(testRoot, "book-writer-rag-corpus-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function put(root: string, relPath: string, text: string): void {
  const full = join(root, ...relPath.split("/"));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text, "utf8");
}

describe("scanRagCorpusFiles", () => {
  it("labels known chapter roots exactly as the chapters table does", () => {
    // A retrieval result and the chapters list can name the same file on
    // adjacent screens, so the labels have to agree. raglib.py's directory-
    // derived names ("book", "prequel-novella") would disagree with BOOK_ROOTS.
    const root = projectRoot();
    put(root, "world/characters/mira.md", "# Mira\n\nA character.");
    put(root, "world/notes.json", '{"a":1}');
    put(root, "chapters/Chapter 1 - Arrival.txt", "text");
    put(root, "chapters/notes.md", "# Notes");
    put(root, "book-2/chapters/Chapter 1 - Return.txt", "text");
    put(root, "prequel-novella/chapters/Chapter 1 - Origins.txt", "text");

    const summary = scanRagCorpusFiles(root)
      .map((file) => ({ relPath: file.relPath, book: file.book }))
      .sort((a, b) => a.relPath.localeCompare(b.relPath));

    expect(summary).toEqual([
      { relPath: "book-2/chapters/Chapter 1 - Return.txt", book: "book-2" },
      { relPath: "chapters/Chapter 1 - Arrival.txt", book: "book-1" },
      { relPath: "chapters/notes.md", book: "book-1" },
      { relPath: "prequel-novella/chapters/Chapter 1 - Origins.txt", book: "prequel" },
      { relPath: "world/characters/mira.md", book: "world" },
      { relPath: "world/notes.json", book: "world" },
    ]);
  });

  it("falls back to the parent directory name for a chapters root outside BOOK_ROOTS", () => {
    const root = projectRoot();
    put(root, "side-stories/chapters/Chapter 1 - Aside.txt", "text");

    expect(scanRagCorpusFiles(root).map((file) => file.book)).toEqual(["side-stories"]);
  });

  it("ignores hidden directories and node_modules/dist chapters roots, matching raglib.py's exclusion", () => {
    const root = projectRoot();
    put(root, ".git/chapters/hidden.txt", "text");
    put(root, "node_modules/some-pkg/chapters/hidden.txt", "text");
    put(root, "dist/chapters/hidden.txt", "text");
    put(root, "chapters/Chapter 1 - Visible.txt", "text");

    expect(scanRagCorpusFiles(root).map((file) => file.relPath)).toEqual(["chapters/Chapter 1 - Visible.txt"]);
  });

  it("only collects .txt/.md under chapters/ and .md/.json under world/", () => {
    const root = projectRoot();
    put(root, "chapters/Chapter 1 - Text.txt", "text");
    put(root, "chapters/notes.md", "notes");
    put(root, "chapters/ignored.json", "{}");
    put(root, "world/lore.md", "lore");
    put(root, "world/data.json", "{}");
    put(root, "world/ignored.txt", "ignored");

    expect(scanRagCorpusFiles(root).map((file) => file.relPath).sort()).toEqual([
      "chapters/Chapter 1 - Text.txt",
      "chapters/notes.md",
      "world/data.json",
      "world/lore.md",
    ]);
  });

  it("assigns a stable fileId derived from rel_path, independent of scan order", () => {
    const root = projectRoot();
    put(root, "world/a.md", "a");
    const first = scanRagCorpusFiles(root);
    put(root, "world/z.md", "z");
    const second = scanRagCorpusFiles(root);
    const firstA = first.find((file) => file.relPath === "world/a.md");
    const secondA = second.find((file) => file.relPath === "world/a.md");
    expect(firstA?.fileId).toBe(secondA?.fileId);
    expect(firstA?.fileId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not follow symlinked files or directories outside the project root", () => {
    const root = projectRoot();
    const outside = projectRoot();
    put(outside, "secret.md", "outside secret");
    mkdirSync(join(root, "world"), { recursive: true });

    try {
      symlinkSync(join(outside, "secret.md"), join(root, "world", "linked.md"), "file");
      symlinkSync(outside, join(root, "world", "linked-directory"), "junction");
    } catch {
      // Windows may deny symlink creation without Developer Mode. The
      // regular containment assertions below still run on those machines.
    }

    put(root, "world/inside.md", "inside");
    const files = scanRagCorpusFiles(root).map((file) => file.relPath);
    expect(files).toEqual(["world/inside.md"]);
  });

  it("refuses a symlinked project root entirely", () => {
    const root = projectRoot();
    const outside = projectRoot();
    put(outside, "world/secret.md", "outside secret");
    const linkedRoot = join(root, "linked-root");
    try {
      symlinkSync(outside, linkedRoot, "junction");
    } catch {
      return; // cannot exercise this assertion without symlink support
    }
    expect(scanRagCorpusFiles(linkedRoot)).toEqual([]);
  });

  it("returns an empty list for a project root that does not exist", () => {
    expect(scanRagCorpusFiles(join(projectRoot(), "does-not-exist"))).toEqual([]);
  });
});

describe("chunkRagFile", () => {
  it("routes .md/.json through the heading-aware chunker and .txt through the plain one", () => {
    const mdChunks = chunkRagFile({ fileId: "f1", relPath: "world/doc.md", book: "world", text: "# Heading\n\nBody." });
    expect(mdChunks[0]).toMatchObject({ heading: "Heading", chunkId: "f1::0", fileId: "f1", book: "world" });

    const txtChunks = chunkRagFile({ fileId: "f2", relPath: "chapters/c.txt", book: "book", text: "# Not a heading in txt\n\nBody." });
    expect(txtChunks[0].heading).toBe("");
    expect(txtChunks[0].chunkId).toBe("f2::0");
  });
});

describe("syncRagCorpusFiles", () => {
  it("tracks added, unchanged, updated, and deleted files across successive syncs", () => {
    const root = projectRoot();
    put(root, "world/a.md", "Alpha content.");
    put(root, "chapters/Chapter 1 - One.txt", "Chapter text.");

    const db = openDb(":memory:");
    const project = createProject(db, { projectId: "project-rag", name: "RAG", rootPath: root });

    expect(syncRagCorpusFiles(db, project)).toMatchObject({ scanned: 2, added: 2, updated: 0, unchanged: 0, deleted: 0 });
    expect(syncRagCorpusFiles(db, project)).toMatchObject({ scanned: 2, added: 0, updated: 0, unchanged: 2, deleted: 0 });

    put(root, "world/a.md", "Alpha content, now with more text so the size cache detects the change.");
    expect(syncRagCorpusFiles(db, project)).toMatchObject({ scanned: 2, added: 0, updated: 1, unchanged: 1, deleted: 0 });

    rmSync(join(root, "chapters", "Chapter 1 - One.txt"));
    expect(syncRagCorpusFiles(db, project)).toMatchObject({ scanned: 1, added: 0, updated: 0, unchanged: 1, deleted: 1 });

    expect(db.prepare("SELECT COUNT(*) AS n FROM project_rag_files WHERE project_id = ?").get(project.projectId)).toMatchObject({
      n: 1,
    });

    db.close();
  });

  it("never reads file content for a metadata-unchanged file (skip-if-unchanged fast path)", () => {
    const root = projectRoot();
    put(root, "world/cached.md", "Cached content.");
    const db = openDb(":memory:");
    const project = createProject(db, { projectId: "project-rag-cache", name: "RAG", rootPath: root });

    expect(syncRagCorpusFiles(db, project)).toMatchObject({ added: 1 });
    const before = db.prepare("SELECT content_sha256, indexed_at FROM project_rag_files WHERE project_id = ?").get(project.projectId);
    expect(syncRagCorpusFiles(db, project)).toMatchObject({ unchanged: 1 });
    const after = db.prepare("SELECT content_sha256, indexed_at FROM project_rag_files WHERE project_id = ?").get(project.projectId);
    // An unchanged sync must not touch the row at all, not even re-stamp indexed_at.
    expect(after).toEqual(before);

    db.close();
  });

  it("clears a changed file's stale chunks and cascades chunk deletion when the file is removed", () => {
    const root = projectRoot();
    put(root, "world/a.md", "Alpha content.");
    const db = openDb(":memory:");
    const project = createProject(db, { projectId: "project-rag-chunks", name: "RAG", rootPath: root });
    syncRagCorpusFiles(db, project);

    const fileRow = db
      .prepare("SELECT file_id FROM project_rag_files WHERE project_id = ?")
      .get(project.projectId) as { file_id: string };
    replaceRagFileChunks(db, project.projectId, fileRow.file_id, [
      {
        chunkId: `${fileRow.file_id}::0`,
        fileId: fileRow.file_id,
        relPath: "world/a.md",
        book: "world",
        heading: "",
        chunkIndex: 0,
        text: "Alpha content.",
        charCount: 14,
        modelId: "test-model",
        modelSha256: "abc",
        embeddingDim: 3,
        embedding: new Float32Array([1, 0, 0]),
      },
    ]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM project_rag_chunks WHERE project_id = ?").get(project.projectId)).toMatchObject({
      n: 1,
    });

    put(root, "world/a.md", "Alpha content, changed enough to trip the size check.");
    syncRagCorpusFiles(db, project);
    expect(db.prepare("SELECT COUNT(*) AS n FROM project_rag_chunks WHERE project_id = ?").get(project.projectId)).toMatchObject({
      n: 0,
    });

    rmSync(join(root, "world", "a.md"));
    syncRagCorpusFiles(db, project);
    expect(db.prepare("SELECT COUNT(*) AS n FROM project_rag_files WHERE project_id = ?").get(project.projectId)).toMatchObject({
      n: 0,
    });

    db.close();
  });

  it("isolates rag files by project even when the same corpus path is registered twice", () => {
    const rootOne = projectRoot();
    const rootTwo = projectRoot();
    put(rootOne, "world/shared.md", "first project content");
    put(rootTwo, "world/shared.md", "second project content");

    const db = openDb(":memory:");
    const projectOne = createProject(db, { projectId: "project-one", name: "One", rootPath: rootOne });
    const projectTwo = createProject(db, { projectId: "project-two", name: "Two", rootPath: rootTwo });
    syncRagCorpusFiles(db, projectOne);
    syncRagCorpusFiles(db, projectTwo);

    const rowFor = (projectId: string) =>
      db.prepare("SELECT content_sha256 FROM project_rag_files WHERE project_id = ? AND rel_path = ?").get(projectId, "world/shared.md");
    expect(rowFor(projectOne.projectId)).not.toEqual(rowFor(projectTwo.projectId));

    db.close();
  });
});
