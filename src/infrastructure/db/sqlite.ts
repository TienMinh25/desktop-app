import Database from "better-sqlite3"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

export type Db = Database.Database

// One DB per machine (one employee per machine by company policy), next to the other files in ~/.ccodex
export function openDb(ccodexDirectory: string): Db {
  mkdirSync(ccodexDirectory, { recursive: true })
  const db = new Database(join(ccodexDirectory, "ccodex.db"))
  configureConnection(db)
  return db
}

// These pragmas hold per connection, so every process runs them on every open
// WAL + busy_timeout let main and harness use the file at the same time, foreign_keys makes ON DELETE CASCADE work
export function configureConnection(db: Db): void {
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")
}

// Only main calls this, once at startup before the harness opens the DB
// user_version is a number stored in the SQLite file header: 0 = new file, N = schema version N
// A new file gets the full schema, a later version adds a branch: if (version === N) { ALTER ...; user_version = N + 1 }
export function migrate(db: Db): void {
  const { user_version } = db.prepare("PRAGMA user_version").get() as { user_version: number }
  if (user_version === 0) db.transaction(() => db.exec(SCHEMA)).immediate()
}

// Main writes projects/sessions/config/mcp/skills, harness writes messages/artifacts/compactions
const SCHEMA = `
CREATE TABLE projects (
  id             TEXT NOT NULL PRIMARY KEY,
  key            TEXT NOT NULL,
  name           TEXT NOT NULL,
  is_assigned    INTEGER NOT NULL DEFAULT 1 CHECK (is_assigned IN (0,1)),
  sort_order     INTEGER NOT NULL DEFAULT 0,
  fetched_at     INTEGER NOT NULL,
  last_opened_at INTEGER
) STRICT;

CREATE TABLE sessions (
  id           TEXT NOT NULL PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  directory    TEXT NOT NULL,
  title        TEXT NOT NULL,
  last_preview TEXT CHECK (last_preview IS NULL OR length(last_preview) <= 200),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;
CREATE INDEX sessions_sidebar ON sessions(project_id, updated_at DESC);

CREATE TABLE session_config (
  session_id      TEXT NOT NULL PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  provider_id     INTEGER NOT NULL,
  model_id        INTEGER NOT NULL,
  effort_id       INTEGER,
  permission_mode TEXT NOT NULL DEFAULT 'manual' CHECK (permission_mode IN ('manual','auto-safe','full-access'))
) STRICT;

CREATE TABLE messages (
  id           INTEGER PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL CHECK (seq > 0),
  role         TEXT NOT NULL CHECK (role IN ('user','assistant')),
  parts_json   TEXT NOT NULL CHECK (json_valid(parts_json)
                 AND json_type(parts_json, '$.v') IS 'integer'
                 AND json_extract(parts_json, '$.v') IS 1
                 AND json_type(parts_json, '$.parts') IS 'array'),
  total_tokens INTEGER CHECK (total_tokens >= 0),
  updated_at   INTEGER NOT NULL,
  UNIQUE (session_id, seq),
  CHECK (role = 'assistant' OR total_tokens IS NULL)
) STRICT;
CREATE TRIGGER messages_identity_immutable BEFORE UPDATE OF id, session_id, seq, role ON messages
WHEN NEW.id IS NOT OLD.id OR NEW.session_id IS NOT OLD.session_id OR NEW.seq IS NOT OLD.seq OR NEW.role IS NOT OLD.role
BEGIN SELECT RAISE(ABORT, 'message identity is immutable'); END;

CREATE TABLE artifacts (
  id         INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  direction  TEXT NOT NULL CHECK (direction IN ('in','out')),
  path       TEXT NOT NULL,
  name       TEXT NOT NULL,
  mime_type  TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX artifacts_by_message ON artifacts(message_id);
CREATE TRIGGER artifacts_direction_matches_role BEFORE INSERT ON artifacts
WHEN (SELECT role FROM messages WHERE id = NEW.message_id) IS NOT (CASE NEW.direction WHEN 'in' THEN 'user' ELSE 'assistant' END)
BEGIN SELECT RAISE(ABORT, 'artifact direction does not match message role'); END;
CREATE TRIGGER artifacts_immutable BEFORE UPDATE ON artifacts
BEGIN SELECT RAISE(ABORT, 'artifact is immutable'); END;

CREATE TABLE compactions (
  id             TEXT NOT NULL PRIMARY KEY,
  session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  summary_text   TEXT NOT NULL CHECK (length(summary_text) > 0),
  checkpoint_seq INTEGER NOT NULL CHECK (checkpoint_seq > 0),
  tokens_before  INTEGER CHECK (tokens_before >= 0),
  tokens_after   INTEGER CHECK (tokens_after >= 0),
  UNIQUE (session_id, checkpoint_seq)
) STRICT;
CREATE INDEX compactions_latest ON compactions(session_id, checkpoint_seq DESC);
CREATE TRIGGER compactions_valid BEFORE INSERT ON compactions
WHEN NOT EXISTS (SELECT 1 FROM messages WHERE session_id = NEW.session_id AND seq = NEW.checkpoint_seq)
BEGIN SELECT RAISE(ABORT, 'invalid compaction references'); END;
CREATE TRIGGER compactions_immutable BEFORE UPDATE ON compactions
BEGIN SELECT RAISE(ABORT, 'compaction is immutable'); END;

CREATE TABLE mcp_servers (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL UNIQUE CHECK (name NOT GLOB '*__*'),
  display_name     TEXT NOT NULL,
  transport        TEXT NOT NULL CHECK (transport IN ('stdio','http','sse')),
  config_json      TEXT NOT NULL CHECK (json_valid(config_json) AND json_type(config_json) = 'object'),
  secret_refs_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(secret_refs_json) AND json_type(secret_refs_json) = 'array'),
  enabled          INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1))
) STRICT;

CREATE TABLE skills (
  id      TEXT NOT NULL PRIMARY KEY,
  name    TEXT NOT NULL UNIQUE,
  path    TEXT NOT NULL UNIQUE,
  version TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1))
) STRICT;

CREATE TABLE session_mcp_servers (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  mcp_id     INTEGER NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  enabled    INTEGER NOT NULL CHECK (enabled IN (0,1)),
  PRIMARY KEY (session_id, mcp_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX session_mcp_servers_by_mcp ON session_mcp_servers(mcp_id);

CREATE TABLE session_skills (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  skill_id   TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  enabled    INTEGER NOT NULL CHECK (enabled IN (0,1)),
  PRIMARY KEY (session_id, skill_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX session_skills_by_skill ON session_skills(skill_id);

PRAGMA user_version = 1;
`
