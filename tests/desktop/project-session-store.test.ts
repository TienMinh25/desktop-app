import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { createSession, deleteSession, listProjects, listSessions, renameSession, searchSidebar, syncProjects } from "../../src/desktop/main/project-session-store"
import { configureConnection, migrate, type Db } from "../../src/infrastructure/db/sqlite"

function memoryDb(): Db {
  const db = new Database(":memory:") as unknown as Db
  configureConnection(db)
  migrate(db)
  return db
}

test("listProjects keeps the backend order", () => {
  const db = memoryDb()
  syncProjects(db, [{ id: "9", key: "P-9", name: "Zeta" }, { id: "3", key: "P-3", name: "Alpha" }])
  expect(listProjects(db).map((p) => p.id)).toEqual(["9", "3"])
  syncProjects(db, [{ id: "3", key: "P-3", name: "Alpha" }, { id: "9", key: "P-9", name: "Zeta" }])
  expect(listProjects(db).map((p) => p.id)).toEqual(["3", "9"])
})

test("syncProjects upserts, unassigns missing projects and assigns them again", () => {
  const db = memoryDb()
  syncProjects(db, [{ id: "101", key: "P-101", name: "Formbuilder" }, { id: "102", key: "P-102", name: "CRM" }], 1000)
  syncProjects(db, [{ id: "101", key: "P-101", name: "Formbuilder v2" }], 2000)
  expect(listProjects(db).map((p) => [p.id, p.key, p.name, p.isAssigned, p.fetchedAt])).toEqual([
    ["101", "P-101", "Formbuilder v2", true, 2000],
    ["102", "P-102", "CRM", false, 2000],
  ])
  syncProjects(db, [{ id: "101", key: "P-101", name: "Formbuilder v2" }, { id: "102", key: "P-102", name: "CRM" }], 3000)
  expect(listProjects(db).every((p) => p.isAssigned)).toBe(true)
})

test("listSessions returns the sessions of one project, newest first", () => {
  const db = memoryDb()
  syncProjects(db, [{ id: "101", key: "P-101", name: "Formbuilder" }, { id: "102", key: "P-102", name: "CRM" }], 1000)
  const insert = db.prepare("INSERT INTO sessions (id, project_id, directory, title, created_at, updated_at) VALUES (?, ?, '/repo', ?, 1, ?)")
  insert.run("s1", "101", "Old", 10)
  insert.run("s2", "101", "New", 20)
  insert.run("s3", "102", "Other project", 30)
  expect(listSessions(db, "101").map((s) => [s.id, s.projectId])).toEqual([["s2", "101"], ["s1", "101"]])
})

test("createSession, renameSession and deleteSession persist to the sidebar list", () => {
  const db = memoryDb()
  syncProjects(db, [{ id: "101", key: "P-101", name: "Formbuilder" }])
  const created = createSession(db, "101", "/home", "New chat #1", 1000)
  expect(listSessions(db, "101")).toEqual([created])
  renameSession(db, created.id, "Fix logo")
  expect(listSessions(db, "101")[0]?.title).toBe("Fix logo")
  expect(() => createSession(db, "missing", "/home", "x")).toThrow()
})

test("deleteSession removes the row and its messages", () => {
  const db = memoryDb()
  syncProjects(db, [{ id: "101", key: "P-101", name: "Formbuilder" }])
  const created = createSession(db, "101", "/home", "New chat #1", 1000)
  db.prepare("INSERT INTO messages (session_id, seq, role, parts_json, updated_at) VALUES (?, 1, 'user', ?, 1)")
    .run(created.id, JSON.stringify({ v: 1, parts: [{ type: "text", text: "hi" }] }))
  deleteSession(db, created.id)
  expect(listSessions(db, "101")).toEqual([])
  expect(db.prepare("SELECT count(*) AS n FROM messages").get()).toEqual({ n: 0 })
})

test("searchSidebar matches project names and chat titles of assigned projects, ignoring case", () => {
  const db = memoryDb()
  syncProjects(db, [{ id: "1", key: "P-1", name: "Formbuilder" }, { id: "2", key: "P-2", name: "Renamer" }])
  const logo = createSession(db, "1", "/home", "Fix logo")
  createSession(db, "2", "/home", "Build form 50%")
  expect(searchSidebar(db, "FORM")).toEqual({ projectIds: ["1"], sessionIds: [expect.any(String)] })
  expect(searchSidebar(db, "logo")).toEqual({ projectIds: [], sessionIds: [logo.id] })
  // % is plain text, not a LIKE wildcard
  expect(searchSidebar(db, "%").sessionIds).toHaveLength(1)
  syncProjects(db, [{ id: "2", key: "P-2", name: "Renamer" }])
  expect(searchSidebar(db, "logo")).toEqual({ projectIds: [], sessionIds: [] })
})
