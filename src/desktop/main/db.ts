import Database from "better-sqlite3"
import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

export type Db = Database.Database

export interface ProjectRow {
  id: string
  name: string
  memberStatus: "active" | "removed"
  fetchedAt: number
}

export interface SessionRow {
  id: string
  title: string
  lastPreview: string | null
  updatedAt: number
}

// One DB per account: <userData>/accounts/<ldap>/ccodex.db
export function dbPath(userDataDir: string, ldap: string): string {
  // Block path tricks like "../" in ldap
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(ldap)) throw new Error(`Invalid ldap: ${ldap}`)
  return join(userDataDir, "accounts", ldap, "ccodex.db")
}

export function openDb(path: string): Db {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  migrate(db)
  return db
}

export function migrate(db: Db): void {
  // WAL + busy_timeout: main and harness share this file
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")
  const { user_version } = db.prepare("PRAGMA user_version").get() as { user_version: number }
  // New file only, add a branch per version when the schema changes
  if (user_version === 0) db.transaction(() => db.exec(SCHEMA)).immediate()
}

// Backend list is the source of truth, missing projects become 'removed'
// Skip on backend error (null body), otherwise every project is marked removed
export function syncProjects(db: Db, projects: Array<{ id: string; name: string }>, now = Date.now()): void {
  const upsert = db.prepare(`
    INSERT INTO projects (id, name, member_status, fetched_at) VALUES (?, ?, 'active', ?)
    ON CONFLICT (id) DO UPDATE SET name = excluded.name, member_status = 'active', fetched_at = excluded.fetched_at`)
  const markRemoved = db.prepare(`
    UPDATE projects SET member_status = 'removed', fetched_at = ?
    WHERE member_status = 'active' AND id NOT IN (SELECT value FROM json_each(?))`)
  db.transaction(() => {
    for (const project of projects) upsert.run(project.id, project.name, now)
    markRemoved.run(now, JSON.stringify(projects.map((project) => project.id)))
  }).immediate()
}

export function listProjects(db: Db): ProjectRow[] {
  return db.prepare(`
    SELECT id, name, member_status AS memberStatus, fetched_at AS fetchedAt
    FROM projects
    ORDER BY name`).all() as ProjectRow[]
}

// Sidebar list only, messages load when a session is opened
export function listSessions(db: Db, projectId: string): SessionRow[] {
  return db.prepare(`
    SELECT id, title, last_preview AS lastPreview, updated_at AS updatedAt
    FROM sessions
    WHERE project_id = ? AND deleted_at IS NULL
    ORDER BY updated_at DESC`).all(projectId) as SessionRow[]
}

export function createSession(db: Db, projectId: string, directory: string, title: string, now = Date.now()): SessionRow {
  const id = randomUUID()
  db.prepare(`
    INSERT INTO sessions (id, project_id, directory, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(id, projectId, directory, title, now, now)
  return { id, title, lastPreview: null, updatedAt: now }
}

// Keep updated_at so a rename does not move the chat to the top
export function renameSession(db: Db, id: string, title: string): void {
  db.prepare("UPDATE sessions SET title = ? WHERE id = ? AND deleted_at IS NULL").run(title, id)
}

// Soft delete, the row stays for audit and undo
export function deleteSession(db: Db, id: string, now = Date.now()): void {
  db.prepare("UPDATE sessions SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL").run(now, id)
}

export interface SearchHit {
  id: string
  snippet: string | null
}

// Match session title or text parts, snippet comes from the latest matching message
export function searchSessions(db: Db, query: string): SearchHit[] {
  // Treat % and _ typed by the user as plain text
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`
  const rows = db.prepare(`
    SELECT id, text FROM (
      SELECT s.id, s.title, (
        SELECT json_extract(p.value, '$.text') FROM messages m, json_each(m.parts_json, '$.parts') p
        WHERE m.session_id = s.id AND json_extract(p.value, '$.type') = 'text'
          AND json_extract(p.value, '$.text') LIKE ? ESCAPE '\\'
        ORDER BY m.seq DESC LIMIT 1) AS text
      -- Hide sessions of projects the user was removed from
      FROM sessions s JOIN projects pr ON pr.id = s.project_id AND pr.member_status = 'active'
      WHERE s.deleted_at IS NULL)
    WHERE title LIKE ? ESCAPE '\\' OR text IS NOT NULL`).all(pattern, pattern) as Array<{ id: string; text: string | null }>
  return rows.map((row) => ({ id: row.id, snippet: row.text === null ? null : snippetAround(row.text, query) }))
}

// Start a few words before the hit so it stays visible in the narrow sidebar
function snippetAround(text: string, query: string): string {
  const flat = text.replace(/\s+/g, " ").trim()
  const at = flat.toLowerCase().indexOf(query.toLowerCase())
  return at > 15 ? `…${flat.slice(flat.lastIndexOf(" ", at - 12) + 1)}` : flat
}

// Main writes projects/sessions/config/mcp/skills, harness writes messages/artifacts/compactions
const SCHEMA = `
CREATE TABLE projects (
  id             TEXT NOT NULL PRIMARY KEY,
  name           TEXT NOT NULL,
  member_status  TEXT NOT NULL DEFAULT 'active' CHECK (member_status IN ('active','removed')),
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
  updated_at   INTEGER NOT NULL CHECK (updated_at >= created_at),
  deleted_at   INTEGER
) STRICT;
CREATE INDEX sessions_sidebar ON sessions(project_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE session_config (
  session_id      TEXT NOT NULL PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  provider_id     INTEGER NOT NULL,
  model_id        INTEGER NOT NULL,
  effort_id       INTEGER,
  permission_mode TEXT NOT NULL DEFAULT 'ask'
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
