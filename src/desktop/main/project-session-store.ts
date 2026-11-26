import { randomUUID } from "node:crypto"
import type { ProjectRow, SessionRow, SidebarSearchResult } from "../../contracts/projects"
import type { Db } from "../../infrastructure/db/sqlite"

// Backend list is the source of truth for assignment and order, missing projects get is_assigned = 0
// Call only with a successful response, an empty list unassigns every project
export function syncProjects(db: Db, projects: Pick<ProjectRow, "id" | "key" | "name">[], now = Date.now()): void {
  const list = JSON.stringify(projects)
  db.transaction(() => {
    // One statement for the whole list, json_each key is the position in the backend response
    db.prepare(`
      INSERT INTO projects (id, key, name, is_assigned, sort_order, fetched_at)
      SELECT json_extract(p.value, '$.id'), json_extract(p.value, '$.key'), json_extract(p.value, '$.name'), 1, p.key, ?
      FROM json_each(?) AS p WHERE true
      ON CONFLICT (id) DO UPDATE SET key = excluded.key, name = excluded.name, is_assigned = 1,
        sort_order = excluded.sort_order, fetched_at = excluded.fetched_at`).run(now, list)
    db.prepare(`
      UPDATE projects SET is_assigned = 0, fetched_at = ?
      WHERE is_assigned = 1 AND id NOT IN (SELECT json_extract(value, '$.id') FROM json_each(?))`).run(now, list)
  }).immediate()
}

export function listProjects(db: Db): ProjectRow[] {
  const rows = db.prepare(`
    SELECT id, key, name, is_assigned AS isAssigned, fetched_at AS fetchedAt
    FROM projects
    ORDER BY sort_order`).all() as Array<Omit<ProjectRow, "isAssigned"> & { isAssigned: number }>
  // SQLite has no boolean type, the column holds 0 or 1
  return rows.map((row) => ({ ...row, isAssigned: row.isAssigned === 1 }))
}

// Sidebar list only, messages load when a session is opened
export function listSessions(db: Db, projectId: string): SessionRow[] {
  return db.prepare(`
    SELECT id, project_id AS projectId, title, last_preview AS lastPreview, updated_at AS updatedAt
    FROM sessions
    WHERE project_id = ?
    ORDER BY updated_at DESC`).all(projectId) as SessionRow[]
}

export function createSession(db: Db, projectId: string, directory: string, title: string, now = Date.now()): SessionRow {
  const id = randomUUID()
  db.prepare(`
    INSERT INTO sessions (id, project_id, directory, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(id, projectId, directory, title, now, now)
  return { id, projectId, title, lastPreview: null, updatedAt: now }
}

// Keep updated_at so a rename does not move the chat to the top
export function renameSession(db: Db, id: string, title: string): void {
  db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(title, id)
}

export class SessionRunningError extends Error {
  constructor(readonly sessionId: string) {
    super("Cannot delete a session while a turn is running.")
    this.name = "SessionRunningError"
  }
}

export function deleteSession(db: Db, id: string, options: { harnessAlive: boolean }): void {
  db.transaction(() => {
    if (options.harnessAlive) {
      const running = db.prepare(`
        SELECT 1 FROM messages
        WHERE session_id = ? AND role = 'assistant' AND state = 'running'`).get(id)
      if (running) throw new SessionRunningError(id)
    }
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id)
    pruneOrphanBlobs(db)
  }).immediate()
}

// shortcut: SQLite lower() folds ASCII only, "Đ" will not match "đ", add a folded column if users need it
export function searchSidebar(db: Db, query: string): SidebarSearchResult {
  const projectIds = db.prepare(`
    SELECT id FROM projects
    WHERE is_assigned = 1 AND instr(lower(name), lower(?)) > 0`).all(query) as Array<{ id: string }>
  const sessionIds = db.prepare(`
    SELECT s.id FROM sessions AS s JOIN projects AS p ON p.id = s.project_id
    WHERE p.is_assigned = 1 AND instr(lower(s.title), lower(?)) > 0`).all(query) as Array<{ id: string }>
  return { projectIds: projectIds.map((row) => row.id), sessionIds: sessionIds.map((row) => row.id) }
}

// Session delete cascades to artifacts, so blobs no artifact references any more are removed in the same transaction
function pruneOrphanBlobs(db: Db): number {
  return db.prepare(`
    DELETE FROM media_blob
    WHERE NOT EXISTS (
      SELECT 1 FROM artifacts WHERE artifacts.sha256 = media_blob.sha256
    )`).run().changes
}
