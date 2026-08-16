-- Shared Book Writer database schema.
-- Manuscript files remain the source of truth; these tables are the indexed
-- and durable application state used by the server and desktop clients.

CREATE TABLE IF NOT EXISTS chapters (
  chapter_id  TEXT PRIMARY KEY,
  book        TEXT NOT NULL,
  rel_path    TEXT NOT NULL UNIQUE,
  number      REAL NOT NULL,
  title       TEXT NOT NULL,
  text        TEXT NOT NULL,
  sha256      TEXT NOT NULL,
  word_count  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  file_mtime  TEXT,
  file_size   INTEGER NOT NULL DEFAULT -1,
  synced_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chapters_book_num ON chapters(book, number);

CREATE TABLE IF NOT EXISTS skills (
  skill_id        TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  pipeline_order  INTEGER NOT NULL,
  phase           TEXT NOT NULL,
  blurb           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  argument_hint   TEXT NOT NULL DEFAULT '',
  image_path      TEXT NOT NULL,
  has_rag_variant INTEGER NOT NULL DEFAULT 0,
  synced_at       TEXT
);

-- Legacy Claude-specific history. Keep this table and all of its columns for
-- existing installs; provider-neutral runs are stored in agent_runs below.
CREATE TABLE IF NOT EXISTS claude_runs (
  run_id          TEXT PRIMARY KEY,
  skill_id        TEXT REFERENCES skills(skill_id),
  variant         TEXT NOT NULL DEFAULT 'base',
  prompt          TEXT NOT NULL,
  permission_mode TEXT NOT NULL DEFAULT 'acceptEdits',
  status          TEXT NOT NULL,
  result_text     TEXT NOT NULL DEFAULT '',
  error           TEXT,
  transcript_path TEXT,
  num_turns       INTEGER,
  duration_ms     INTEGER,
  total_cost_usd  REAL,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  created_at      TEXT NOT NULL,
  started_at      TEXT,
  finished_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_skill ON claude_runs(skill_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rag_queries (
  query_id     TEXT PRIMARY KEY,
  q            TEXT NOT NULL,
  k            INTEGER NOT NULL,
  source       TEXT NOT NULL DEFAULT 'ui',
  ok           INTEGER NOT NULL,
  error        TEXT,
  result_count INTEGER,
  total_tokens INTEGER,
  latency_ms   INTEGER,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- A project is a manuscript workspace known to the desktop application. The
-- server can continue to operate with its existing MANUSCRIPT_ROOT setting;
-- project rows are additive metadata and do not replace that configuration.
CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  root_path  TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1
);

-- Desktop projects need an isolated chapter snapshot because chapter IDs and
-- relative paths repeat naturally across manuscripts. Keep the legacy
-- `chapters` table unchanged while the server compatibility path still
-- addresses one MANUSCRIPT_ROOT at a time.
CREATE TABLE IF NOT EXISTS project_chapters (
  project_id   TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  chapter_id   TEXT NOT NULL,
  book         TEXT NOT NULL,
  rel_path     TEXT NOT NULL,
  number       REAL NOT NULL,
  title        TEXT NOT NULL,
  text         TEXT NOT NULL,
  sha256       TEXT NOT NULL,
  word_count   INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  file_mtime   TEXT,
  file_size    INTEGER NOT NULL DEFAULT -1,
  synced_at    TEXT NOT NULL,
  PRIMARY KEY(project_id, chapter_id),
  UNIQUE(project_id, rel_path)
);
CREATE INDEX IF NOT EXISTS idx_project_chapters_book_num
  ON project_chapters(project_id, active, book, number, chapter_id);

-- JSON settings are scoped to a project and timestamped for renderer-facing
-- records. The legacy global string `settings` table remains unchanged.
CREATE TABLE IF NOT EXISTS project_settings (
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id, key)
);

-- Provider configuration is deliberately data-only. Secrets should be
-- represented by an environment/keychain reference, never stored as a raw
-- token in this table.
CREATE TABLE IF NOT EXISTS provider_settings (
  provider_setting_id TEXT PRIMARY KEY,
  project_id          TEXT REFERENCES projects(project_id) ON DELETE CASCADE,
  provider            TEXT NOT NULL,
  setting_key        TEXT,
  setting_value      TEXT,
  config_json        TEXT NOT NULL DEFAULT '{}',
  enabled            INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE(project_id, provider, setting_key)
);

-- Provider-neutral run history. claude_runs remains the compatibility ledger
-- for the existing Claude bridge; new providers can use this common shape.
CREATE TABLE IF NOT EXISTS agent_runs (
  run_id          TEXT PRIMARY KEY,
  project_id      TEXT REFERENCES projects(project_id) ON DELETE SET NULL,
  provider        TEXT NOT NULL,
  model           TEXT,
  skill_id        TEXT REFERENCES skills(skill_id),
  variant         TEXT NOT NULL DEFAULT 'base',
  prompt          TEXT NOT NULL,
  permission_mode TEXT NOT NULL DEFAULT 'default',
  status          TEXT NOT NULL,
  result_text     TEXT NOT NULL DEFAULT '',
  error           TEXT,
  transcript_path TEXT,
  num_turns       INTEGER,
  duration_ms     INTEGER,
  total_cost_usd  REAL,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  created_at      TEXT NOT NULL,
  started_at      TEXT,
  finished_at     TEXT
);

-- Migration 3: native project-scoped semantic RAG index.

-- One row per corpus source file (world/*.md, world/*.json, **/chapters/*.txt|*.md),
-- reusing the same mtime/size skip-if-unchanged cache pattern migration 2
-- added to project_chapters (file_mtime, file_size >= 0 means "trust the cache").
CREATE TABLE IF NOT EXISTS project_rag_files (
  project_id   TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  file_id      TEXT NOT NULL,              -- stable hash of rel_path, like raglib.py's "<rel>::<i>" scheme
  rel_path     TEXT NOT NULL,
  book         TEXT NOT NULL,              -- "world" | "book" | "book-2" | "prequel-novella" | ...
  file_mtime   TEXT,
  file_size    INTEGER NOT NULL DEFAULT -1,
  content_sha256 TEXT NOT NULL,            -- detects content changes even if mtime is unreliable
  chunk_count  INTEGER NOT NULL DEFAULT 0,
  indexed_at   TEXT NOT NULL,
  PRIMARY KEY (project_id, file_id),
  UNIQUE (project_id, rel_path)
);
CREATE INDEX IF NOT EXISTS idx_project_rag_files_project ON project_rag_files(project_id);

-- One row per chunk. Vector stored as a raw little-endian Float32 BLOB
-- (embedding_dim * 4 bytes); no external vector-store format needed for
-- brute-force cosine over a few thousand rows.
CREATE TABLE IF NOT EXISTS project_rag_chunks (
  project_id    TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  chunk_id      TEXT NOT NULL,             -- e.g. "<file_id>::<index>"
  file_id       TEXT NOT NULL,
  rel_path      TEXT NOT NULL,             -- denormalized for cheap result mapping without a join
  book          TEXT NOT NULL,
  heading       TEXT NOT NULL DEFAULT '',
  chunk_index   INTEGER NOT NULL,
  text          TEXT NOT NULL,
  char_count    INTEGER NOT NULL,
  model_id      TEXT NOT NULL,             -- e.g. "Xenova/all-MiniLM-L6-v2"
  model_sha256  TEXT NOT NULL,             -- ties a vector to the exact model bytes that produced it
  embedding_dim INTEGER NOT NULL,
  embedding     BLOB NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (project_id, chunk_id),
  FOREIGN KEY (project_id, file_id) REFERENCES project_rag_files(project_id, file_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_project_rag_chunks_file ON project_rag_chunks(project_id, file_id);

-- One row per project: index status for the health/status IPC call without
-- rescanning or reloading vectors. Mirrors how runs/manager.ts keeps status
-- in memory but this needs to survive app restarts.
CREATE TABLE IF NOT EXISTS project_rag_index_state (
  project_id     TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'never_indexed', -- never_indexed | indexing | ready | failed | cancelled
  model_id       TEXT,
  model_sha256   TEXT,
  total_files    INTEGER NOT NULL DEFAULT 0,
  total_chunks   INTEGER NOT NULL DEFAULT 0,
  last_indexed_at TEXT,
  last_error     TEXT,
  updated_at     TEXT NOT NULL
);
