import { randomUUID } from "node:crypto"
import type { ProjectRow, SearchHit, SessionRow } from "../../contracts/projects"
import type { Db } from "../../infrastructure/db/sqlite"

// Backend list is the source of truth for membership and order, missing projects become 'removed'
// Call only with a successful response, an empty list marks every project removed
export function syncProjects(db: Db, projects: Pick<ProjectRow, "id" | "name">[], now = Date.now()): void {
  const upsert = db.prepare(`
    INSERT INTO projects (id, name, member_status, sort_order, fetched_at) VALUES (?, ?, 'active', ?, ?)
    ON CONFLICT (id) DO UPDATE SET name = excluded.name, member_status = 'active', sort_order = excluded.sort_order, fetched_at = excluded.fetched_at`)
  const markRemoved = db.prepare(`
    UPDATE projects SET member_status = 'removed', fetched_at = ?
    WHERE member_status = 'active' AND id NOT IN (SELECT value FROM json_each(?))`)
  db.transaction(() => {
    projects.forEach((project, index) => upsert.run(project.id, project.name, index, now))
    markRemoved.run(now, JSON.stringify(projects.map((project) => project.id)))
  }).immediate()
}

export function listProjects(db: Db): ProjectRow[] {
  return db.prepare(`
    SELECT id, name, member_status AS memberStatus, fetched_at AS fetchedAt
    FROM projects
    ORDER BY sort_order`).all() as ProjectRow[]
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
  // Cap length, a long tool output would otherwise go whole over IPC
  return (at > 15 ? `…${flat.slice(flat.lastIndexOf(" ", at - 12) + 1)}` : flat).slice(0, 160)
}
