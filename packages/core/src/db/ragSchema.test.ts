import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DATABASE_SCHEMA_VERSION, getSchemaVersion, openDb } from "./db.js";

/**
 * Migration 3 (design §4's native project-scoped RAG index) coverage,
 * matching the style of db.test.ts's existing "backs up and upgrades a
 * version 1 database" test and phase7Compatibility.test.ts: build a raw
 * fixture database that looks like it just finished migration 2, then open
 * it through `openDb` and assert both the new tables and the untouched old
 * data.
 */

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), "book-writer-rag-migration-"));
  temporaryDirectories.push(directory);
  return join(directory, "bookwriter.db");
}

/**
 * A genuine v2 database has every table migration 1 created (chapters,
 * skills, claude_runs, rag_queries, settings, projects, project_chapters,
 * project_settings, provider_settings, agent_runs) plus migration 2's
 * file_size columns — this fixture is the minimal such database, so
 * `assertCurrentSchema`'s post-migration check exercises the same table set
 * a real upgrade would see.
 */
function seedV2Database(dbPath: string): void {
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE chapters (
      chapter_id TEXT PRIMARY KEY, book TEXT NOT NULL, rel_path TEXT NOT NULL UNIQUE,
      number REAL NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL, sha256 TEXT NOT NULL,
      word_count INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
      file_mtime TEXT, file_size INTEGER NOT NULL DEFAULT -1, synced_at TEXT NOT NULL
    );
    CREATE TABLE skills (
      skill_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, pipeline_order INTEGER NOT NULL,
      phase TEXT NOT NULL, blurb TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      argument_hint TEXT NOT NULL DEFAULT '', image_path TEXT NOT NULL,
      has_rag_variant INTEGER NOT NULL DEFAULT 0, synced_at TEXT
    );
    CREATE TABLE claude_runs (
      run_id TEXT PRIMARY KEY, skill_id TEXT, variant TEXT NOT NULL DEFAULT 'base', prompt TEXT NOT NULL,
      permission_mode TEXT NOT NULL DEFAULT 'acceptEdits', status TEXT NOT NULL,
      result_text TEXT NOT NULL DEFAULT '', error TEXT, transcript_path TEXT, num_turns INTEGER,
      duration_ms INTEGER, total_cost_usd REAL, input_tokens INTEGER, output_tokens INTEGER,
      created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT
    );
    CREATE TABLE rag_queries (
      query_id TEXT PRIMARY KEY, q TEXT NOT NULL, k INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'ui',
      ok INTEGER NOT NULL, error TEXT, result_count INTEGER, total_tokens INTEGER, latency_ms INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE projects (
      project_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE project_chapters (
      project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
      chapter_id TEXT NOT NULL,
      book TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      number REAL NOT NULL,
      title TEXT NOT NULL,
      text TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      word_count INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      file_mtime TEXT,
      file_size INTEGER NOT NULL DEFAULT -1,
      synced_at TEXT NOT NULL,
      PRIMARY KEY(project_id, chapter_id)
    );
    CREATE TABLE project_settings (
      project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
      key TEXT NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(project_id, key)
    );
    CREATE TABLE provider_settings (
      provider_setting_id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(project_id) ON DELETE CASCADE,
      provider TEXT NOT NULL, setting_key TEXT, setting_value TEXT, config_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(project_id, provider, setting_key)
    );
    CREATE TABLE agent_runs (
      run_id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(project_id) ON DELETE SET NULL,
      provider TEXT NOT NULL, model TEXT, skill_id TEXT, variant TEXT NOT NULL DEFAULT 'base',
      prompt TEXT NOT NULL, permission_mode TEXT NOT NULL DEFAULT 'default', status TEXT NOT NULL,
      result_text TEXT NOT NULL DEFAULT '', error TEXT, transcript_path TEXT, num_turns INTEGER,
      duration_ms INTEGER, total_cost_usd REAL, input_tokens INTEGER, output_tokens INTEGER,
      created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT
    );
    INSERT INTO projects(project_id, name, root_path, created_at, updated_at)
      VALUES ('project_keep', 'Keep Me', '/keep', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    INSERT INTO project_chapters(
      project_id, chapter_id, book, rel_path, number, title, text, sha256, word_count, file_mtime, file_size, synced_at
    ) VALUES (
      'project_keep', 'book-1/Chapter 1.txt', 'book-1', 'chapters/Chapter 1.txt', 1, 'One',
      'keep this text', 'legacy-hash', 3, '2026-01-01T00:00:00Z', 42, '2026-01-01T00:00:00Z'
    );
    PRAGMA user_version = 2;
  `);
  legacy.close();
}

describe("migration 3: native RAG schema", () => {
  it("adds the RAG tables to a v2 database and leaves existing data untouched", () => {
    expect(DATABASE_SCHEMA_VERSION).toBe(3);
    const dbPath = temporaryDatabase();
    seedV2Database(dbPath);

    const upgraded = openDb(dbPath);
    expect(getSchemaVersion(upgraded)).toBe(3);

    // Pre-existing rows and tables are exactly as they were.
    expect(upgraded.prepare("SELECT name FROM projects WHERE project_id = ?").get("project_keep")).toMatchObject({
      name: "Keep Me",
    });
    expect(
      upgraded.prepare("SELECT text, file_size FROM project_chapters WHERE chapter_id = ?").get("book-1/Chapter 1.txt"),
    ).toMatchObject({ text: "keep this text", file_size: 42 });

    // The three new tables exist with the exact columns from design §4.
    const columnsOf = (table: string): string[] =>
      (upgraded.pragma(`table_info(${table})`) as Array<{ name: string }>).map((column) => column.name);

    expect(columnsOf("project_rag_files")).toEqual([
      "project_id",
      "file_id",
      "rel_path",
      "book",
      "file_mtime",
      "file_size",
      "content_sha256",
      "chunk_count",
      "indexed_at",
    ]);
    expect(columnsOf("project_rag_chunks")).toEqual([
      "project_id",
      "chunk_id",
      "file_id",
      "rel_path",
      "book",
      "heading",
      "chunk_index",
      "text",
      "char_count",
      "model_id",
      "model_sha256",
      "embedding_dim",
      "embedding",
      "created_at",
    ]);
    expect(columnsOf("project_rag_index_state")).toEqual([
      "project_id",
      "status",
      "model_id",
      "model_sha256",
      "total_files",
      "total_chunks",
      "last_indexed_at",
      "last_error",
      "updated_at",
    ]);

    // Both new tables are immediately usable and correctly scoped/FK'd.
    upgraded
      .prepare(
        `INSERT INTO project_rag_files(project_id, file_id, rel_path, book, file_mtime, file_size, content_sha256, chunk_count, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("project_keep", "file-1", "world/a.md", "world", "2026-08-16T00:00:00Z", 10, "hash", 0, "2026-08-16T00:00:00Z");
    expect(
      upgraded.prepare("SELECT rel_path FROM project_rag_files WHERE project_id = ? AND file_id = ?").get("project_keep", "file-1"),
    ).toMatchObject({ rel_path: "world/a.md" });

    upgraded.close();
  });

  it("is idempotent: opening an already-current database is a no-op migration", () => {
    const dbPath = temporaryDatabase();
    const first = openDb(dbPath);
    expect(getSchemaVersion(first)).toBe(3);
    first.close();

    const reopened = openDb(dbPath);
    expect(getSchemaVersion(reopened)).toBe(3);
    reopened.close();
  });

  it("requires all three RAG tables for a database claiming to already be at version 3", () => {
    const dbPath = temporaryDatabase();
    const damaged = new Database(dbPath);
    damaged.exec("CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);");
    damaged.pragma("user_version = 3");
    damaged.close();

    expect(() => openDb(dbPath)).toThrow(/Database schema 3 is invalid/);
  });
});
