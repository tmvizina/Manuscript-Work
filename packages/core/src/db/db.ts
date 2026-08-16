import Database from "better-sqlite3";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const schemaPath = fileURLToPath(new URL("./schema.sql", import.meta.url));

/**
 * SQLite's user_version pragma tracks the schema shipped in this release.
 * Existing databases have user_version 0 and are treated as the legacy
 * baseline by migration 1.
 */
export const DATABASE_SCHEMA_VERSION = 2;
/** Backwards-friendly aliases for hosts that prefer a shorter name. */
export const CURRENT_SCHEMA_VERSION = DATABASE_SCHEMA_VERSION;
export const SCHEMA_VERSION = DATABASE_SCHEMA_VERSION;

/** Default wait for another SQLite connection to release its lock. */
export const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

export type DB = Database.Database;

export interface DatabaseBackupOptions {
  /** Write a backup to this exact path. The file must not already exist. */
  path?: string;
  /** Directory for an automatically named, timestamped backup. */
  directory?: string;
}

export interface OpenDbOptions {
  /** Override the bundled schema for an embedding host that owns the file. */
  schemaSql?: string;
  /** Milliseconds SQLite waits for a concurrent reader/writer before failing. */
  busyTimeoutMs?: number;
  /** Configure where the pre-migration backup is written. */
  backup?: DatabaseBackupOptions;
  /** Convenience alias for backup.path. */
  backupPath?: string;
  /** Convenience alias for backup.directory. */
  backupDirectory?: string;
}

/**
 * Open a shared Book Writer database and apply versioned schema migrations.
 *
 * A persistent database that needs an upgrade is serialized to a distinct
 * backup file before any schema-changing SQL runs. Each migration is then
 * executed in one SQLite transaction; a failed migration leaves the original
 * database at its previous schema version and keeps the backup for recovery.
 */
export function openDb(dbPath: string, options: OpenDbOptions = {}): DB {
  const busyTimeoutMs = normalizeBusyTimeout(options.busyTimeoutMs);
  const persistent = isPersistentDatabasePath(dbPath);
  const existedBeforeOpen = persistent && existingDatabaseFile(dbPath);
  if (persistent) mkdirSync(dirname(dbPath), { recursive: true });

  let db: DB | undefined;
  try {
    db = new Database(dbPath);
    db.pragma(`busy_timeout = ${busyTimeoutMs}`);
    db.pragma("foreign_keys = ON");

    const schemaVersion = getSchemaVersion(db);
    if (schemaVersion > DATABASE_SCHEMA_VERSION) {
      throw new Error(
        `Database schema version ${schemaVersion} is newer than this application supports (${DATABASE_SCHEMA_VERSION})`,
      );
    }

    const schema = options.schemaSql ?? readFileSync(schemaPath, "utf-8");
    if (schemaVersion < DATABASE_SCHEMA_VERSION) {
      // Hold the write reservation across both snapshot and migration. This
      // prevents another process from committing after the recovery point was
      // captured but before the schema transaction completes.
      db.exec("BEGIN IMMEDIATE");
      try {
        assertDatabaseIntegrity(db, "source database");
        if (existedBeforeOpen) {
          const backupPath = resolveBackupPath(dbPath, options);
          createDatabaseBackup(db, backupPath, dbPath);
        }
        applyPendingMigrations(db, schema);
        db.exec("COMMIT");
      } catch (error) {
        if (db.inTransaction) db.exec("ROLLBACK");
        throw error;
      }
      // Keep the old journal mode until the migration commits. Changing the
      // mode itself can update the database header, so it must not precede
      // the pre-upgrade snapshot.
    }

    assertDatabaseIntegrity(db, "database");
    assertCurrentSchema(db);

    // WAL is a connection/database setting, not part of the schema. Apply it
    // only after a migration has committed so a failed upgrade leaves the
    // source database untouched apart from SQLite's normal rollback journal.
    db.pragma("journal_mode = WAL");
    return db;
  } catch (error) {
    if (db?.open) db.close();
    throw error;
  }
}

/**
 * Read the version recorded in SQLite's user_version header.
 */
export function getSchemaVersion(db: DB): number {
  const version = db.pragma("user_version", { simple: true });
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
    throw new Error(`Invalid database schema version: ${String(version)}`);
  }
  return version;
}

type Migration = (db: DB, schemaSql: string) => void;

/**
 * Versioned migrations. Migration 1 establishes the current shared schema
 * and repairs the additive columns used by partially migrated legacy files.
 * Future migrations should be appended with their own version number rather
 * than changing an already-applied migration.
 */
const migrations: Readonly<Record<number, Migration>> = {
  1: (db, schemaSql) => {
    db.exec(schemaSql);
    migrateLegacyColumns(db);
  },
  2: (db) => {
    migrateChapterFileMetadataColumns(db);
  },
};

/** Apply all pending migrations atomically. */
export function migrate(db: DB, schemaSql = readFileSync(schemaPath, "utf-8")): void {
  const fromVersion = getSchemaVersion(db);
  if (fromVersion > DATABASE_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${fromVersion} is newer than this application supports (${DATABASE_SCHEMA_VERSION})`,
    );
  }
  if (fromVersion === DATABASE_SCHEMA_VERSION) return;

  const runMigrations = db.transaction(() => applyPendingMigrations(db, schemaSql));
  runMigrations();
}

function applyPendingMigrations(db: DB, schemaSql: string): void {
  const fromVersion = getSchemaVersion(db);
  for (let version = fromVersion + 1; version <= DATABASE_SCHEMA_VERSION; version += 1) {
    const migration = migrations[version];
    if (!migration) throw new Error(`Missing database migration for schema version ${version}`);
    migration(db, schemaSql);
    db.pragma(`user_version = ${version}`);
  }
}

/**
 * Additive repairs for databases created by the pre-versioned app.
 * CREATE TABLE IF NOT EXISTS in migration 1 handles missing tables; the
 * column checks keep partially migrated databases usable as well.
 */
function migrateLegacyColumns(db: DB): void {
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
    addColumn("agent_runs", "error", "TEXT");
    addColumn("agent_runs", "transcript_path", "TEXT");
    addColumn("agent_runs", "num_turns", "INTEGER");
    addColumn("agent_runs", "duration_ms", "INTEGER");
    addColumn("agent_runs", "total_cost_usd", "REAL");
    addColumn("agent_runs", "input_tokens", "INTEGER");
    addColumn("agent_runs", "output_tokens", "INTEGER");
    addColumn("agent_runs", "created_at", "TEXT NOT NULL DEFAULT ''");
    addColumn("agent_runs", "started_at", "TEXT");
    addColumn("agent_runs", "finished_at", "TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_agent_runs_project ON agent_runs(project_id, created_at DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_agent_runs_provider ON agent_runs(provider, created_at DESC)");
  }
}

/** Add the persistent file-size cache used by metadata-only chapter syncs. */
function migrateChapterFileMetadataColumns(db: DB): void {
  const addColumn = (table: string): void => {
    if (!tableExists(db, table)) return;
    const columns = (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((column) => column.name);
    if (!columns.includes("file_size")) {
      // -1 marks rows created before the metadata cache existed. They are
      // hydrated once on the next sync instead of being trusted as unchanged.
      db.exec(`ALTER TABLE ${table} ADD COLUMN file_size INTEGER NOT NULL DEFAULT -1`);
    }
  };

  addColumn("chapters");
  addColumn("project_chapters");
}

function normalizeBusyTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_BUSY_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 2_147_483_647) {
    throw new TypeError("busyTimeoutMs must be a non-negative 32-bit integer");
  }
  return timeout;
}

function isPersistentDatabasePath(dbPath: string): boolean {
  return dbPath !== ":memory:" && !dbPath.startsWith("file::memory:");
}

function existingDatabaseFile(dbPath: string): boolean {
  try {
    return statSync(dbPath).isFile() && statSync(dbPath).size > 0;
  } catch {
    return false;
  }
}

function resolveBackupPath(dbPath: string, options: OpenDbOptions): string {
  const explicitPath = options.backupPath ?? options.backup?.path;
  if (explicitPath) return resolve(explicitPath);

  const directory = options.backupDirectory ?? options.backup?.directory ?? dirname(resolve(dbPath));
  const timestamp = nowIso().replace(/[-:.]/g, "");
  const filename = `${basename(dbPath)}.backup-${timestamp}-${randomUUID().replace(/-/g, "").slice(0, 8)}.sqlite`;
  return resolve(directory, filename);
}

/**
 * Create a crash-safe, point-in-time backup from a live SQLite connection.
 * serialize() includes committed WAL state and avoids copying a main file
 * without its companion -wal file. The temporary file is fsynced before the
 * final rename so a failed write cannot be mistaken for a valid backup.
 */
export function createDatabaseBackup(db: DB, backupPath: string, sourcePath?: string): string {
  const destination = resolve(backupPath);
  if (sourcePath && destination === resolve(sourcePath)) {
    throw new Error("Database backup path must differ from the source database path");
  }
  if (existsSync(destination)) {
    throw new Error(`Database backup path already exists: ${destination}`);
  }

  mkdirSync(dirname(destination), { recursive: true });
  // Put the incomplete marker before the final filename so recovery scans for
  // `<database>.backup-*` can never mistake a crash remnant for a backup.
  const temporaryPath = resolve(
    dirname(destination),
    `.incomplete-${randomUUID().replace(/-/g, "")}-${basename(destination)}`,
  );
  let committed = false;
  try {
    writeFileSync(temporaryPath, db.serialize(), { flag: "wx" });
    const descriptor = openSync(temporaryPath, "r+");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    const verification = new Database(temporaryPath, { readonly: true, fileMustExist: true });
    try {
      assertDatabaseIntegrity(verification, "database backup");
    } finally {
      verification.close();
    }
    renameSync(temporaryPath, destination);
    committed = true;
    return destination;
  } finally {
    if (!committed) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // Preserve the migration error; cleanup is best effort.
      }
    }
  }
}

function assertDatabaseIntegrity(db: DB, label: string): void {
  const rows = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
  if (rows.length !== 1 || rows[0]?.integrity_check !== "ok") {
    const details = rows.map((row) => row.integrity_check).filter(Boolean).join("; ") || "unknown error";
    throw new Error(`SQLite integrity check failed for ${label}: ${details}`);
  }
}

const requiredSchema: Readonly<Record<string, readonly string[]>> = {
  chapters: ["chapter_id", "rel_path", "text", "file_size"],
  skills: ["skill_id", "display_name"],
  claude_runs: ["run_id", "prompt", "status"],
  rag_queries: ["query_id", "q"],
  settings: ["key", "value"],
  projects: ["project_id", "root_path", "updated_at", "active"],
  project_chapters: ["project_id", "chapter_id", "file_size"],
  project_settings: ["project_id", "key", "value_json"],
  provider_settings: ["provider_setting_id", "provider", "config_json"],
  agent_runs: ["run_id", "provider", "status", "created_at"],
};

function assertCurrentSchema(db: DB): void {
  for (const [table, requiredColumns] of Object.entries(requiredSchema)) {
    const columns = new Set(
      (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((column) => column.name),
    );
    const missing = requiredColumns.filter((column) => !columns.has(column));
    if (missing.length > 0) {
      throw new Error(`Database schema ${DATABASE_SCHEMA_VERSION} is invalid: ${table} is missing ${missing.join(", ")}`);
    }
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
