-- Book Writer app schema. The .txt chapter files remain the source of truth;
-- the chapters table is a synced copy (fast list/search + snapshot-on-read).

CREATE TABLE IF NOT EXISTS chapters (
  chapter_id  TEXT PRIMARY KEY,            -- '<book>/<filename>'
  book        TEXT NOT NULL,               -- 'book-1' | 'book-2' | 'prequel'
  rel_path    TEXT NOT NULL UNIQUE,        -- relative to MANUSCRIPT_ROOT
  number      REAL NOT NULL,               -- 1, 0.5, 12.5 (fractional interludes)
  title       TEXT NOT NULL,
  text        TEXT NOT NULL,
  sha256      TEXT NOT NULL,
  word_count  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,  -- 0 = file vanished from disk (kept, not deleted)
  file_mtime  TEXT,
  synced_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chapters_book_num ON chapters(book, number);

CREATE TABLE IF NOT EXISTS skills (
  skill_id        TEXT PRIMARY KEY,        -- 'book-reviewer'
  display_name    TEXT NOT NULL,
  pipeline_order  INTEGER NOT NULL,
  phase           TEXT NOT NULL,           -- 'intake' | 'generation' | 'revision' | 'output'
  blurb           TEXT NOT NULL,           -- curated 1-2 sentences (seeded)
  description     TEXT NOT NULL DEFAULT '',-- full SKILL.md frontmatter description (synced)
  argument_hint   TEXT NOT NULL DEFAULT '',
  image_path      TEXT NOT NULL,           -- '/skill-art/book-reviewer.svg'
  has_rag_variant INTEGER NOT NULL DEFAULT 0,
  synced_at       TEXT
);

CREATE TABLE IF NOT EXISTS claude_runs (
  run_id          TEXT PRIMARY KEY,
  skill_id        TEXT REFERENCES skills(skill_id),  -- NULL = free-form prompt
  variant         TEXT NOT NULL DEFAULT 'base',      -- 'base' | 'rag'
  prompt          TEXT NOT NULL,                     -- full text sent to claude -p
  permission_mode TEXT NOT NULL DEFAULT 'acceptEdits',
  status          TEXT NOT NULL,                     -- queued|running|done|error|cancelled
  result_text     TEXT NOT NULL DEFAULT '',
  error           TEXT,
  transcript_path TEXT,                              -- data/runs/<run_id>.ndjson
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
  source       TEXT NOT NULL DEFAULT 'ui',  -- 'ui' | 'skill' | 'other'
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

-- Shared workspace metadata. These tables are additive; claude_runs above is
-- deliberately retained as the legacy Claude-bridge history ledger.
CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  root_path  TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_projects_active ON projects(active, updated_at DESC);

-- Provider settings are scoped to a project when project_id is supplied. A
-- keychain/environment reference belongs in setting_value; raw secrets do not.
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
CREATE INDEX IF NOT EXISTS idx_provider_settings_project
  ON provider_settings(project_id, provider);

-- Provider-neutral run ledger for Claude, Codex, and future agent providers.
-- Existing Claude runs remain in claude_runs and are never renamed or removed.
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
CREATE INDEX IF NOT EXISTS idx_agent_runs_project
  ON agent_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_provider
  ON agent_runs(provider, created_at DESC);
