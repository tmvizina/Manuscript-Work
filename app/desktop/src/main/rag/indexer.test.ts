import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { countRagChunks, getRagIndexState, openDb, searchRagChunks, type DB } from "@book-writer/core";
import { DeterministicFakeEmbedder } from "./fakeEmbedder.js";
import { RagIndexer } from "./indexer.js";
import type { VerifiedRagModel } from "./modelManifest.js";

const MODEL: VerifiedRagModel = {
  modelPath: "model.onnx",
  tokenizerDir: "tokenizer",
  modelId: "test/model",
  modelSha256: "a".repeat(64),
  embeddingDim: 384,
};

let workspace: string;
let db: DB;
let projectRoot: string;

function write(relPath: string, text: string): void {
  const full = join(projectRoot, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, text, "utf8");
}

function project() {
  return { projectId: "proj-1", rootPath: projectRoot };
}

function indexer(embedder = new DeterministicFakeEmbedder()) {
  return { indexer: new RagIndexer({ db, embedder, model: MODEL }), embedder };
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "rag-indexer-"));
  projectRoot = join(workspace, "manuscript");
  mkdirSync(projectRoot, { recursive: true });
  db = openDb(join(workspace, "app.db"));
  db.prepare(
    `INSERT INTO projects(project_id, name, root_path, active, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  ).run("proj-1", "Test", projectRoot, new Date().toISOString(), new Date().toISOString());
});

afterEach(() => {
  db.close();
  rmSync(workspace, { recursive: true, force: true });
});

describe("RagIndexer", () => {
  it("embeds every chunk and reports the index ready", async () => {
    write("chapters/Chapter 1 - Arrival.txt", "First paragraph.\n\nSecond paragraph.");
    write("world/mira.md", "# Mira\n\nA character.");
    const { indexer: subject, embedder } = indexer();

    const result = await subject.reindex(project());

    expect(result.status).toBe("ready");
    expect(result.filesIndexed).toBe(2);
    expect(result.chunksEmbedded).toBeGreaterThan(0);
    expect(countRagChunks(db, "proj-1")).toBe(result.chunksEmbedded);
    expect(embedder.embedCalls).toBeGreaterThan(0);
    expect(getRagIndexState(db, "proj-1")?.status).toBe("ready");
  });

  it("skips unchanged files on a second pass", async () => {
    write("chapters/Chapter 1 - Arrival.txt", "Only paragraph.");
    const first = indexer();
    await first.indexer.reindex(project());

    const second = indexer();
    const result = await second.indexer.reindex(project());

    expect(result.filesIndexed).toBe(0);
    // The whole point of the mtime/size cache: no text is re-embedded.
    expect(second.embedder.embedCalls).toBe(0);
    expect(countRagChunks(db, "proj-1")).toBeGreaterThan(0);
  });

  it("re-embeds a file whose text changed and drops its stale chunks", async () => {
    write("world/mira.md", "# Mira\n\nOriginal.");
    await indexer().indexer.reindex(project());
    const before = countRagChunks(db, "proj-1");

    write("world/mira.md", "# Mira\n\nRewritten.\n\nAnother paragraph.\n\nAnd a third one here.");
    const second = indexer();
    await second.indexer.reindex(project());

    expect(second.embedder.embedCalls).toBeGreaterThan(0);
    const texts = db.prepare(`SELECT text FROM project_rag_chunks WHERE project_id = ?`).all("proj-1") as Array<{ text: string }>;
    expect(texts.some((row) => row.text.includes("Rewritten"))).toBe(true);
    expect(texts.some((row) => row.text.includes("Original"))).toBe(false);
    expect(countRagChunks(db, "proj-1")).not.toBe(before - before);
  });

  it("removes chunks for a file that disappeared", async () => {
    write("world/gone.md", "Temporary note.");
    write("world/stays.md", "Permanent note.");
    await indexer().indexer.reindex(project());

    rmSync(join(projectRoot, "world", "gone.md"));
    await indexer().indexer.reindex(project());

    const paths = db.prepare(`SELECT DISTINCT rel_path FROM project_rag_chunks WHERE project_id = ?`).all("proj-1") as Array<{ rel_path: string }>;
    expect(paths.map((row) => row.rel_path)).toEqual(["world/stays.md"]);
  });

  it("stops at a file boundary when cancelled and leaves a valid partial index", async () => {
    for (let index = 0; index < 6; index += 1) write(`world/note-${index}.md`, `Note ${index} body text.`);
    const signal = { cancelled: false };
    const embedder = new DeterministicFakeEmbedder();
    const subject = new RagIndexer({ db, embedder, model: MODEL });

    const run = subject.reindex(project(), {
      signal,
      onProgress: (progress) => {
        if (progress.filesIndexed >= 2) signal.cancelled = true;
      },
    });
    const result = await run;

    expect(result.status).toBe("cancelled");
    expect(result.filesIndexed).toBeLessThan(6);
    expect(getRagIndexState(db, "proj-1")?.status).toBe("cancelled");
    // Whatever committed stays queryable rather than being rolled back.
    expect(countRagChunks(db, "proj-1")).toBe(result.chunksEmbedded);
  });

  it("resumes an interrupted index without redoing finished files", async () => {
    for (let index = 0; index < 4; index += 1) write(`world/note-${index}.md`, `Note ${index} body.`);
    const signal = { cancelled: false };
    const firstEmbedder = new DeterministicFakeEmbedder();
    await new RagIndexer({ db, embedder: firstEmbedder, model: MODEL }).reindex(project(), {
      signal,
      onProgress: (progress) => {
        if (progress.filesIndexed >= 1) signal.cancelled = true;
      },
    });
    const partial = countRagChunks(db, "proj-1");

    const resumed = indexer();
    const result = await resumed.indexer.reindex(project());

    expect(result.status).toBe("ready");
    expect(countRagChunks(db, "proj-1")).toBeGreaterThan(partial);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM project_rag_files WHERE project_id = ? AND chunk_count = 0`).get("proj-1")).toEqual({ n: 0 });
  });

  it("records a failure without discarding the chunks already committed", async () => {
    write("world/one.md", "First note.");
    await indexer().indexer.reindex(project());
    const existing = countRagChunks(db, "proj-1");

    write("world/two.md", "Second note.");
    const failing = new DeterministicFakeEmbedder();
    failing.failure = new Error("embedder exploded");
    const result = await new RagIndexer({ db, embedder: failing, model: MODEL }).reindex(project());

    expect(result.status).toBe("failed");
    expect(result.error).toContain("exploded");
    expect(getRagIndexState(db, "proj-1")?.lastError).toContain("exploded");
    expect(countRagChunks(db, "proj-1")).toBe(existing);
  });

  it("discards the index when the active model no longer matches", async () => {
    write("world/mira.md", "A character note.");
    await indexer().indexer.reindex(project());

    const other: VerifiedRagModel = { ...MODEL, modelSha256: "b".repeat(64), modelId: "test/other" };
    const embedder = new DeterministicFakeEmbedder();
    await new RagIndexer({ db, embedder, model: other }).reindex(project());

    // Vectors from two models cannot be compared, so every row must carry the
    // new model's identity rather than a mix.
    const models = db.prepare(`SELECT DISTINCT model_sha256 AS sha FROM project_rag_chunks WHERE project_id = ?`).all("proj-1") as Array<{ sha: string }>;
    expect(models).toEqual([{ sha: "b".repeat(64) }]);
  });

  it("ranks a query against stored vectors", async () => {
    write("world/dragon.md", "The dragon note.");
    write("world/blade.md", "The blade note.");
    const embedder = new DeterministicFakeEmbedder();
    const subject = new RagIndexer({ db, embedder, model: MODEL });
    await subject.reindex(project());

    const chunkText = (db.prepare(`SELECT text FROM project_rag_chunks WHERE rel_path = ?`).get("world/dragon.md") as { text: string }).text;
    const results = await subject.query("proj-1", chunkText, 5);

    // The fake maps identical text to an identical unit vector, so the exact
    // chunk must rank first with a score of 1.
    expect(results[0]?.relPath).toBe("world/dragon.md");
    expect(results[0]?.score).toBeCloseTo(1, 6);
  });

  it("reports never_indexed before a first run", () => {
    expect(indexer().indexer.status("proj-1").status).toBe("never_indexed");
  });

  it("finds nothing for a project that was never indexed", () => {
    expect(searchRagChunks(db, "proj-1", new Float32Array(384), 5)).toEqual([]);
  });
});
