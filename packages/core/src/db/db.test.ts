import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DATABASE_SCHEMA_VERSION,
  DEFAULT_BUSY_TIMEOUT_MS,
  getSchemaVersion,
  getSetting,
  newId,
  nowIso,
  openDb,
  setSetting,
} from "./db.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), "book-writer-core-"));
  temporaryDirectories.push(directory);
  return join(directory, "bookwriter.db");
}

describe("shared database core", () => {
  it("creates additive project, provider, and agent-run tables", () => {
    const db = openDb(temporaryDatabase());
    expect(getSchemaVersion(db)).toBe(DATABASE_SCHEMA_VERSION);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;

    for (const table of ["claude_runs", "projects", "project_chapters", "project_settings", "provider_settings", "agent_runs"]) {
      expect(tables.some((entry) => entry.name === table)).toBe(true);
    }

    const now = nowIso();
    db.prepare(
      "INSERT INTO projects(project_id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("project_test", "Test project", "/tmp/test-project", now, now);
    db.prepare(
      "INSERT INTO provider_settings(provider_setting_id, project_id, provider, setting_key, setting_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("setting_test", "project_test", "claude", "api_key_ref", "CLAUDE_API_KEY", now, now);
    db.prepare(
      "INSERT INTO agent_runs(run_id, project_id, provider, prompt, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("run_test", "project_test", "codex", "hello", "queued", now);

    expect(db.prepare("SELECT provider FROM agent_runs WHERE run_id = ?").get("run_test")).toMatchObject({
      provider: "codex",
    });
    db.close();
  });

  it("preserves claude_runs history and settings across reopen", () => {
    const dbPath = temporaryDatabase();
    const first = openDb(dbPath);
    const now = nowIso();
    first
      .prepare(
        "INSERT INTO claude_runs(run_id, variant, prompt, permission_mode, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("legacy_run", "base", "legacy prompt", "acceptEdits", "done", now);
    setSetting(first, "test.key", "first");
    first.close();

    const reopened = openDb(dbPath);
    expect(reopened.prepare("SELECT prompt FROM claude_runs WHERE run_id = ?").get("legacy_run")).toMatchObject({
      prompt: "legacy prompt",
    });
    expect(getSetting(reopened, "test.key")).toBe("first");
    setSetting(reopened, "test.key", "second");
    expect(getSetting(reopened, "test.key")).toBe("second");
    reopened.close();
  });

  it("does not remove an existing legacy database", () => {
    const dbPath = temporaryDatabase();
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE chapters (
        chapter_id TEXT PRIMARY KEY,
        book TEXT NOT NULL,
        rel_path TEXT NOT NULL UNIQUE,
        number REAL NOT NULL,
        title TEXT NOT NULL,
        text TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        word_count INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        file_mtime TEXT,
        synced_at TEXT NOT NULL
      );
      INSERT INTO chapters(
        chapter_id, book, rel_path, number, title, text, sha256, word_count, synced_at
      ) VALUES (
        'book-1/Chapter 1 - Legacy.txt', 'book-1', 'chapters/Chapter 1 - Legacy.txt',
        1, 'Legacy', 'preserve this chapter', 'legacy-hash', 3, '2026-01-01T00:00:00Z'
      );
      CREATE TABLE claude_runs (
        run_id TEXT PRIMARY KEY,
        skill_id TEXT,
        variant TEXT NOT NULL,
        prompt TEXT NOT NULL,
        permission_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        result_text TEXT NOT NULL DEFAULT '',
        error TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO claude_runs(run_id, variant, prompt, permission_mode, status, created_at)
      VALUES ('legacy_only', 'base', 'keep me', 'acceptEdits', 'done', '2026-01-01T00:00:00Z');
    `);
    legacy.close();

    const migrated = openDb(dbPath);
    expect(migrated.prepare("SELECT prompt FROM claude_runs WHERE run_id = ?").get("legacy_only")).toMatchObject({
      prompt: "keep me",
    });
    expect(migrated.prepare("SELECT text FROM chapters WHERE chapter_id = ?").get("book-1/Chapter 1 - Legacy.txt")).toMatchObject({
      text: "preserve this chapter",
    });
    expect(
      (migrated.pragma("table_info(chapters)") as Array<{ name: string }>).some((column) => column.name === "file_size"),
    ).toBe(true);
    expect(migrated.prepare("SELECT file_size FROM chapters WHERE chapter_id = ?").get("book-1/Chapter 1 - Legacy.txt")).toMatchObject({
      file_size: -1,
    });
    expect(migrated.prepare("SELECT 1 FROM sqlite_master WHERE name = 'project_chapters'").get()).toBeTruthy();
    expect(migrated.prepare("SELECT 1 FROM sqlite_master WHERE name = 'project_settings'").get()).toBeTruthy();
    expect(migrated.prepare("SELECT 1 FROM sqlite_master WHERE name = 'agent_runs'").get()).toBeTruthy();
    migrated.close();
  });

  it("backs up a legacy database before applying its first versioned migration", () => {
    const dbPath = temporaryDatabase();
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE projects (
        project_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      INSERT INTO projects(project_id, name, root_path, created_at)
      VALUES ('legacy-project', 'Legacy', '/legacy', '2026-01-01T00:00:00Z');
    `);
    legacy.close();

    const migrated = openDb(dbPath);
    expect(getSchemaVersion(migrated)).toBe(DATABASE_SCHEMA_VERSION);
    migrated.close();

    const backupName = readdirSync(dirname(dbPath)).find((name) =>
      name.startsWith(`${basename(dbPath)}.backup-`),
    );
    expect(backupName).toBeDefined();
    const backup = new Database(join(dirname(dbPath), backupName as string));
    expect(getSchemaVersion(backup)).toBe(0);
    expect(backup.prepare("SELECT name FROM projects WHERE project_id = ?").get("legacy-project")).toMatchObject({
      name: "Legacy",
    });
    expect(
      (backup.pragma("table_info(projects)") as Array<{ name: string }>).some((column) => column.name === "updated_at"),
    ).toBe(false);
    backup.close();
  });

  it("includes committed WAL content in the standalone pre-migration backup", () => {
    const dbPath = temporaryDatabase();
    const legacy = new Database(dbPath);
    legacy.pragma("journal_mode = WAL");
    legacy.pragma("wal_autocheckpoint = 0");
    legacy.exec("CREATE TABLE wal_probe(value TEXT); INSERT INTO wal_probe(value) VALUES ('committed-in-wal');");

    const migrated = openDb(dbPath);
    migrated.close();
    legacy.close();

    const backupName = readdirSync(dirname(dbPath)).find((name) =>
      name.startsWith(`${basename(dbPath)}.backup-`),
    );
    expect(backupName).toBeDefined();
    const backup = new Database(join(dirname(dbPath), backupName as string), { readonly: true });
    expect(backup.prepare("SELECT value FROM wal_probe").get()).toMatchObject({ value: "committed-in-wal" });
    expect(backup.pragma("integrity_check", { simple: true })).toBe("ok");
    backup.close();
  });

  it("rolls back a failed migration and leaves the old version recoverable", () => {
    const dbPath = temporaryDatabase();
    const legacy = new Database(dbPath);
    legacy.exec("CREATE TABLE keep_me(value TEXT); INSERT INTO keep_me(value) VALUES ('untouched');");
    legacy.close();

    expect(() =>
      openDb(dbPath, {
        schemaSql: "CREATE TABLE migration_probe(value TEXT); THIS IS NOT VALID SQL;",
      }),
    ).toThrow();

    const unchanged = new Database(dbPath);
    expect(getSchemaVersion(unchanged)).toBe(0);
    expect(unchanged.prepare("SELECT value FROM keep_me").get()).toMatchObject({ value: "untouched" });
    expect(unchanged.prepare("SELECT name FROM sqlite_master WHERE name = 'migration_probe'").get()).toBeUndefined();
    unchanged.close();

    const backupName = readdirSync(dirname(dbPath)).find((name) =>
      name.startsWith(`${basename(dbPath)}.backup-`),
    );
    expect(backupName).toBeDefined();
  });

  it("refuses a database newer than the bundled migration set", () => {
    const dbPath = temporaryDatabase();
    const newer = new Database(dbPath);
    newer.pragma(`user_version = ${DATABASE_SCHEMA_VERSION + 1}`);
    newer.close();

    expect(() => openDb(dbPath)).toThrow(/newer than this application supports/);

    const unchanged = new Database(dbPath);
    expect(getSchemaVersion(unchanged)).toBe(DATABASE_SCHEMA_VERSION + 1);
    unchanged.close();
    expect(readdirSync(dirname(dbPath)).some((name) => name.startsWith(`${basename(dbPath)}.backup-`))).toBe(false);
  });

  it("rejects a current-version database whose required schema is missing", () => {
    const dbPath = temporaryDatabase();
    const damaged = new Database(dbPath);
    damaged.exec("CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);");
    damaged.pragma(`user_version = ${DATABASE_SCHEMA_VERSION}`);
    damaged.close();

    expect(() => openDb(dbPath)).toThrow(new RegExp(`Database schema ${DATABASE_SCHEMA_VERSION} is invalid`));
  });

  it("configures a finite SQLite busy timeout", () => {
    const db = openDb(":memory:", { busyTimeoutMs: 1_234 });
    expect(db.pragma("busy_timeout", { simple: true })).toBe(1_234);
    db.close();

    const defaultDb = openDb(":memory:");
    expect(defaultDb.pragma("busy_timeout", { simple: true })).toBe(DEFAULT_BUSY_TIMEOUT_MS);
    defaultDb.close();
    expect(() => openDb(":memory:", { busyTimeoutMs: -1 })).toThrow(/busyTimeoutMs/);
  });

  it("backs up and upgrades a version 1 database to the metadata-cache schema", () => {
    const dbPath = temporaryDatabase();
    const original = openDb(dbPath);
    original.exec(`
      ALTER TABLE chapters DROP COLUMN file_size;
      ALTER TABLE project_chapters DROP COLUMN file_size;
      PRAGMA user_version = 1;
    `);
    original.close();

    const upgraded = openDb(dbPath);
    expect(getSchemaVersion(upgraded)).toBe(DATABASE_SCHEMA_VERSION);
    expect((upgraded.pragma("table_info(chapters)") as Array<{ name: string }>).some((column) => column.name === "file_size")).toBe(true);
    upgraded.close();

    const backupName = readdirSync(dirname(dbPath)).find((name) => name.startsWith(`${basename(dbPath)}.backup-`));
    expect(backupName).toBeDefined();
    const backup = new Database(join(dirname(dbPath), backupName as string), { readonly: true });
    expect(getSchemaVersion(backup)).toBe(1);
    expect((backup.pragma("table_info(chapters)") as Array<{ name: string }>).some((column) => column.name === "file_size")).toBe(false);
    backup.close();
  });

  it("generates compact prefixed identifiers", () => {
    expect(newId("run")).toMatch(/^run_[a-f0-9]{12}$/);
  });
});
