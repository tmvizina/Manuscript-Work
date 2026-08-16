import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const schemaPath = fileURLToPath(new URL("./schema.sql", import.meta.url));

export type DB = Database.Database;

export interface OpenDbOptions {
  /** Override the bundled schema for an embedding host that owns the file. */
  schemaSql?: string;
}

/** Open a shared Book Writer database and apply only additive schema changes. */
export function openDb(dbPath: string, options: OpenDbOptions = {}): DB {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schema = options.schemaSql ?? readFileSync(schemaPath, "utf-8");
  db.exec(schema);
  migrate(db);
  return db;
}

/**
 * Additive migrations for databases created by an earlier app version.
 * CREATE TABLE IF NOT EXISTS in the bundled schema handles missing tables;
 * the column checks keep partially migrated databases usable as well.
 */
function migrate(db: DB): void {
  const addColumn = (table: string, column: string, declaration: string): void => {
    const columns = (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((columnInfo) => columnInfo.name);
    if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
  };

  // These are the only columns introduced after the initial shared schema.
  // Defaults are required because SQLite cannot add a NOT NULL column without
  // a value to existing rows.
  if (tableExists(db, "projects")) {
    addColumn("projects", "updated_at", "TEXT NOT NULL DEFAULT ''");
    addColumn("projects", "active", "INTEGER NOT NULL DEFAULT 1");
    db.exec("CREATE INDEX IF NOT EXISTS idx_projects_active ON projects(active, updated_at DESC)");
  }
  if (tableExists(db, "provider_settings")) {
    addColumn("provider_settings", "setting_key", "TEXT");
    addColumn("provider_settings", "setting_value", "TEXT");
    addColumn("provider_settings", "config_json", "TEXT NOT NULL DEFAULT '{}'");
    addColumn("provider_settings", "enabled", "INTEGER NOT NULL DEFAULT 1");
    addColumn("provider_settings", "created_at", "TEXT NOT NULL DEFAULT ''");
    addColumn("provider_settings", "updated_at", "TEXT NOT NULL DEFAULT ''");
    db.exec("CREATE INDEX IF NOT EXISTS idx_provider_settings_project ON provider_settings(project_id, provider)");
  }
  if (tableExists(db, "agent_runs")) {
    addColumn("agent_runs", "model", "TEXT");
    addColumn("agent_runs", "project_id", "TEXT");
    addColumn("agent_runs", "skill_id", "TEXT");
    addColumn("agent_runs", "variant", "TEXT NOT NULL DEFAULT 'base'");
    addColumn("agent_runs", "permission_mode", "TEXT NOT NULL DEFAULT 'default'");
    addColumn("agent_runs", "result_text", "TEXT NOT NULL DEFAULT ''");
    addColumn("agent_runs", "transcript_path", "TEXT");
    addColumn("agent_runs", "created_at", "TEXT NOT NULL DEFAULT ''");
    addColumn("agent_runs", "started_at", "TEXT");
    addColumn("agent_runs", "finished_at", "TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_agent_runs_project ON agent_runs(project_id, created_at DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_agent_runs_provider ON agent_runs(provider, created_at DESC)");
  }
}

function tableExists(db: DB, table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  );
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function getSetting(db: DB, key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(db: DB, key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}
