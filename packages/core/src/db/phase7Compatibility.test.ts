import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DATABASE_SCHEMA_VERSION, getSchemaVersion, openDb } from "./db.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

function spacedDatabasePath(): { directory: string; dbPath: string } {
  const directory = mkdtempSync(join(tmpdir(), "Book Writer Phase 7 "));
  temporaryDirectories.push(directory);
  return { directory, dbPath: join(directory, "book writer.db") };
}

describe("Phase 7 database upgrade and rollback compatibility", () => {
  it("upgrades a v1 database in a path with spaces and preserves the pre-upgrade backup", () => {
    const { directory, dbPath } = spacedDatabasePath();
    const backupPath = join(directory, "pre upgrade backup.sqlite");
    const original = openDb(dbPath);
    original.prepare(
      "INSERT INTO chapters(chapter_id, book, rel_path, number, title, text, sha256, word_count, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("book-1/Chapter 1.txt", "book-1", "Chapter 1.txt", 1, "One", "keep this text", "hash", 3, "2026-08-16T00:00:00Z");
    original.exec("ALTER TABLE chapters DROP COLUMN file_size; ALTER TABLE project_chapters DROP COLUMN file_size; PRAGMA user_version = 1;");
    original.close();

    const upgraded = openDb(dbPath, { backupPath });
    expect(getSchemaVersion(upgraded)).toBe(DATABASE_SCHEMA_VERSION);
    expect(upgraded.prepare("SELECT text, file_size FROM chapters WHERE chapter_id = ?").get("book-1/Chapter 1.txt")).toMatchObject({
      text: "keep this text",
      file_size: -1,
    });
    upgraded.close();

    const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
    expect(getSchemaVersion(backup)).toBe(1);
    expect(backup.prepare("SELECT text FROM chapters WHERE chapter_id = ?").get("book-1/Chapter 1.txt")).toMatchObject({ text: "keep this text" });
    expect(backup.prepare("SELECT name FROM pragma_table_info('chapters') WHERE name = 'file_size'").get()).toBeUndefined();
    expect(backup.pragma("integrity_check", { simple: true })).toBe("ok");
    backup.close();
  });

  it("rolls back a failed migration without changing the old database or its spaced-path recovery copy", () => {
    const { directory, dbPath } = spacedDatabasePath();
    const backupPath = join(directory, "rollback backup.sqlite");
    const legacy = new Database(dbPath);
    legacy.exec("CREATE TABLE keep_me(value TEXT); INSERT INTO keep_me(value) VALUES ('untouched');");
    legacy.close();

    expect(() => openDb(dbPath, {
      backupPath,
      schemaSql: "CREATE TABLE migration_probe(value TEXT); THIS IS NOT VALID SQL;",
    })).toThrow();

    const unchanged = new Database(dbPath, { readonly: true, fileMustExist: true });
    expect(getSchemaVersion(unchanged)).toBe(0);
    expect(unchanged.prepare("SELECT value FROM keep_me").get()).toMatchObject({ value: "untouched" });
    expect(unchanged.prepare("SELECT name FROM sqlite_master WHERE name = 'migration_probe'").get()).toBeUndefined();
    unchanged.close();

    const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
    expect(getSchemaVersion(backup)).toBe(0);
    expect(backup.prepare("SELECT value FROM keep_me").get()).toMatchObject({ value: "untouched" });
    backup.close();
    expect(readdirSync(directory).filter((name) => name.startsWith(`${basename(dbPath)}.backup-`))).toHaveLength(0);
  });
});
