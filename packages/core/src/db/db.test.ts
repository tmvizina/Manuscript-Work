import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getSetting, newId, nowIso, openDb, setSetting } from "./db.js";

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
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;

    for (const table of ["claude_runs", "projects", "provider_settings", "agent_runs"]) {
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
    expect(migrated.prepare("SELECT 1 FROM sqlite_master WHERE name = 'agent_runs'").get()).toBeTruthy();
    migrated.close();
  });

  it("generates compact prefixed identifiers", () => {
    expect(newId("run")).toMatch(/^run_[a-f0-9]{12}$/);
  });
});
