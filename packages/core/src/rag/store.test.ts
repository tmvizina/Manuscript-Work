import { describe, expect, it } from "vitest";
import { createProject, openDb } from "../db/index.js";
import {
  cosineSimilarity,
  decodeRagEmbedding,
  deleteRagFile,
  encodeRagEmbedding,
  getRagIndexState,
  listRagFileIds,
  ragTopK,
  replaceRagFileChunks,
  searchRagChunks,
  upsertRagFile,
  upsertRagIndexState,
  type RagSearchCandidate,
} from "./store.js";

function memoryProject(projectId = "project-store") {
  const db = openDb(":memory:");
  const project = createProject(db, { projectId, name: "Store", rootPath: `./fixtures/${projectId}` });
  return { db, project };
}

describe("embedding BLOB encode/decode", () => {
  it("round-trips a vector through the little-endian Float32 BLOB format", () => {
    const vector = new Float32Array([0.5, -0.25, 3.5, 0, 1e-6, -123.75]);
    const blob = encodeRagEmbedding(vector);
    expect(blob.length).toBe(vector.length * 4);
    expect(Array.from(decodeRagEmbedding(blob, vector.length))).toEqual(Array.from(vector));
  });

  it("is genuinely little-endian, not just round-trip-consistent", () => {
    // 1.0f as IEEE-754 is 0x3F800000; little-endian bytes are 00 00 80 3F.
    const blob = encodeRagEmbedding(new Float32Array([1]));
    expect([...blob]).toEqual([0x00, 0x00, 0x80, 0x3f]);
  });

  it("rejects a blob whose length does not match the declared dimension", () => {
    const blob = encodeRagEmbedding(new Float32Array([1, 2, 3]));
    expect(() => decodeRagEmbedding(blob, 4)).toThrow(RangeError);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors and 0 for orthogonal vectors", () => {
    expect(cosineSimilarity(new Float32Array([1, 0, 0]), new Float32Array([1, 0, 0]))).toBeCloseTo(1, 6);
    expect(cosineSimilarity(new Float32Array([1, 0, 0]), new Float32Array([0, 1, 0]))).toBeCloseTo(0, 6);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity(new Float32Array([1, 0, 0]), new Float32Array([-1, 0, 0]))).toBeCloseTo(-1, 6);
  });

  it("is invariant to vector magnitude", () => {
    expect(cosineSimilarity(new Float32Array([2, 0, 0]), new Float32Array([50, 0, 0]))).toBeCloseTo(1, 6);
  });

  it("returns 0 rather than NaN for a zero-magnitude vector", () => {
    expect(cosineSimilarity(new Float32Array([0, 0, 0]), new Float32Array([1, 0, 0]))).toBe(0);
  });

  it("rejects vectors of mismatched dimension", () => {
    expect(() => cosineSimilarity(new Float32Array([1, 0]), new Float32Array([1, 0, 0]))).toThrow(RangeError);
  });
});

describe("ragTopK", () => {
  const candidates: RagSearchCandidate[] = [
    { chunkId: "c-north", relPath: "a", book: "b", heading: "", text: "north", embedding: new Float32Array([0, 1]) },
    { chunkId: "c-east", relPath: "a", book: "b", heading: "", text: "east", embedding: new Float32Array([1, 0]) },
    { chunkId: "c-northeast", relPath: "a", book: "b", heading: "", text: "northeast", embedding: new Float32Array([1, 1]) },
    { chunkId: "c-south", relPath: "a", book: "b", heading: "", text: "south", embedding: new Float32Array([0, -1]) },
  ];

  it("ranks candidates by cosine similarity to the query, closest first", () => {
    const results = ragTopK(new Float32Array([0, 1]), candidates, 4);
    expect(results.map((result) => result.chunkId)).toEqual(["c-north", "c-northeast", "c-east", "c-south"]);
    expect(results[0].score).toBeCloseTo(1, 6);
    expect(results[3].score).toBeCloseTo(-1, 6);
  });

  it("truncates to k", () => {
    expect(ragTopK(new Float32Array([0, 1]), candidates, 2).map((result) => result.chunkId)).toEqual(["c-north", "c-northeast"]);
  });

  it("breaks exact ties deterministically by ascending chunkId", () => {
    const tied: RagSearchCandidate[] = [
      { chunkId: "z", relPath: "a", book: "b", heading: "", text: "z", embedding: new Float32Array([1, 0]) },
      { chunkId: "a", relPath: "a", book: "b", heading: "", text: "a", embedding: new Float32Array([1, 0]) },
    ];
    expect(ragTopK(new Float32Array([1, 0]), tied, 2).map((result) => result.chunkId)).toEqual(["a", "z"]);
  });

  it("rejects a non-positive or non-integer k", () => {
    expect(() => ragTopK(new Float32Array([1, 0]), candidates, 0)).toThrow(RangeError);
    expect(() => ragTopK(new Float32Array([1, 0]), candidates, 1.5)).toThrow(RangeError);
  });
});

function insertFile(db: ReturnType<typeof openDb>, projectId: string, fileId: string, relPath: string): void {
  upsertRagFile(db, projectId, {
    fileId,
    relPath,
    book: "world",
    fileMtime: "2026-08-16T00:00:00Z",
    fileSize: relPath.length,
    contentSha256: `hash-${fileId}`,
    indexedAt: "2026-08-16T00:00:00Z",
  });
}

describe("chunk CRUD", () => {
  it("replaces a file's chunks atomically and keeps chunk_count in sync", () => {
    const { db, project } = memoryProject();
    insertFile(db, project.projectId, "file-1", "world/a.md");

    replaceRagFileChunks(db, project.projectId, "file-1", [
      {
        chunkId: "file-1::0",
        fileId: "file-1",
        relPath: "world/a.md",
        book: "world",
        heading: "",
        chunkIndex: 0,
        text: "first",
        charCount: 5,
        modelId: "m",
        modelSha256: "s",
        embeddingDim: 2,
        embedding: new Float32Array([1, 0]),
      },
      {
        chunkId: "file-1::1",
        fileId: "file-1",
        relPath: "world/a.md",
        book: "world",
        heading: "",
        chunkIndex: 1,
        text: "second",
        charCount: 6,
        modelId: "m",
        modelSha256: "s",
        embeddingDim: 2,
        embedding: new Float32Array([0, 1]),
      },
    ]);
    expect(
      db.prepare("SELECT chunk_count FROM project_rag_files WHERE project_id = ? AND file_id = ?").get(project.projectId, "file-1"),
    ).toMatchObject({ chunk_count: 2 });

    // Replacing with fewer chunks must not leave the old trailing chunk behind.
    replaceRagFileChunks(db, project.projectId, "file-1", [
      {
        chunkId: "file-1::0",
        fileId: "file-1",
        relPath: "world/a.md",
        book: "world",
        heading: "",
        chunkIndex: 0,
        text: "only",
        charCount: 4,
        modelId: "m",
        modelSha256: "s",
        embeddingDim: 2,
        embedding: new Float32Array([1, 1]),
      },
    ]);
    const rows = db.prepare("SELECT chunk_id FROM project_rag_chunks WHERE project_id = ? ORDER BY chunk_id").all(project.projectId);
    expect(rows).toEqual([{ chunk_id: "file-1::0" }]);
    expect(
      db.prepare("SELECT chunk_count FROM project_rag_files WHERE project_id = ? AND file_id = ?").get(project.projectId, "file-1"),
    ).toMatchObject({ chunk_count: 1 });

    db.close();
  });

  it("cascades chunk deletion when a file row is deleted", () => {
    const { db, project } = memoryProject();
    insertFile(db, project.projectId, "file-cascade", "world/b.md");
    replaceRagFileChunks(db, project.projectId, "file-cascade", [
      {
        chunkId: "file-cascade::0",
        fileId: "file-cascade",
        relPath: "world/b.md",
        book: "world",
        heading: "",
        chunkIndex: 0,
        text: "x",
        charCount: 1,
        modelId: "m",
        modelSha256: "s",
        embeddingDim: 1,
        embedding: new Float32Array([1]),
      },
    ]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM project_rag_chunks WHERE project_id = ?").get(project.projectId)).toMatchObject({
      n: 1,
    });

    deleteRagFile(db, project.projectId, "file-cascade");
    expect(db.prepare("SELECT COUNT(*) AS n FROM project_rag_chunks WHERE project_id = ?").get(project.projectId)).toMatchObject({
      n: 0,
    });
    expect(listRagFileIds(db, project.projectId)).toEqual([]);

    db.close();
  });

  it("isolates chunk rows by project even when chunk_id collides across projects", () => {
    const db = openDb(":memory:");
    const projectA = createProject(db, { projectId: "project-a", name: "A", rootPath: "./fixtures/a" });
    const projectB = createProject(db, { projectId: "project-b", name: "B", rootPath: "./fixtures/b" });
    for (const project of [projectA, projectB]) insertFile(db, project.projectId, "shared-file", "world/shared.md");

    replaceRagFileChunks(db, projectA.projectId, "shared-file", [
      {
        chunkId: "shared-file::0",
        fileId: "shared-file",
        relPath: "world/shared.md",
        book: "world",
        heading: "",
        chunkIndex: 0,
        text: "from A",
        charCount: 6,
        modelId: "m",
        modelSha256: "s",
        embeddingDim: 1,
        embedding: new Float32Array([1]),
      },
    ]);
    replaceRagFileChunks(db, projectB.projectId, "shared-file", [
      {
        chunkId: "shared-file::0",
        fileId: "shared-file",
        relPath: "world/shared.md",
        book: "world",
        heading: "",
        chunkIndex: 0,
        text: "from B",
        charCount: 6,
        modelId: "m",
        modelSha256: "s",
        embeddingDim: 1,
        embedding: new Float32Array([1]),
      },
    ]);

    expect(searchRagChunks(db, projectA.projectId, new Float32Array([1]), 1)[0].text).toBe("from A");
    expect(searchRagChunks(db, projectB.projectId, new Float32Array([1]), 1)[0].text).toBe("from B");

    db.close();
  });

  it("finds the closest chunk end-to-end through the database", () => {
    const { db, project } = memoryProject();
    insertFile(db, project.projectId, "file-search", "world/c.md");
    replaceRagFileChunks(db, project.projectId, "file-search", [
      {
        chunkId: "file-search::0",
        fileId: "file-search",
        relPath: "world/c.md",
        book: "world",
        heading: "dragons",
        chunkIndex: 0,
        text: "About dragons.",
        charCount: 15,
        modelId: "m",
        modelSha256: "s",
        embeddingDim: 3,
        embedding: new Float32Array([1, 0, 0]),
      },
      {
        chunkId: "file-search::1",
        fileId: "file-search",
        relPath: "world/c.md",
        book: "world",
        heading: "orchards",
        chunkIndex: 1,
        text: "About orchards.",
        charCount: 16,
        modelId: "m",
        modelSha256: "s",
        embeddingDim: 3,
        embedding: new Float32Array([0, 1, 0]),
      },
    ]);

    const results = searchRagChunks(db, project.projectId, new Float32Array([0.9, 0.1, 0]), 1);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ chunkId: "file-search::0", heading: "dragons" });

    db.close();
  });
});

describe("rag index state", () => {
  it("is null until first written, then merges partial patches", () => {
    const { db, project } = memoryProject();
    expect(getRagIndexState(db, project.projectId)).toBeNull();

    upsertRagIndexState(db, project.projectId, { status: "indexing", totalFiles: 5 });
    expect(getRagIndexState(db, project.projectId)).toMatchObject({ status: "indexing", totalFiles: 5, totalChunks: 0 });

    upsertRagIndexState(db, project.projectId, { status: "ready", totalChunks: 42, modelId: "m1" });
    expect(getRagIndexState(db, project.projectId)).toMatchObject({
      status: "ready",
      totalFiles: 5,
      totalChunks: 42,
      modelId: "m1",
    });

    db.close();
  });
});
