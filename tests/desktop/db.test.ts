import { join } from "node:path"
import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { createSession, dbPath, deleteSession, listProjects, listSessions, migrate, renameSession, searchSessions, syncProjects, type Db } from "../../src/desktop/main/db"

function memoryDb(): Db {
  const db = new Database(":memory:") as unknown as Db
  migrate(db)
  return db
}

test("dbPath keeps each account in its own folder and rejects path tricks", () => {
  expect(dbPath("/data", "42")).toBe(join("/data", "accounts", "42", "ccodex.db"))
  for (const bad of ["", "..", "../x", "a/b", ".hidden"]) expect(() => dbPath("/data", bad)).toThrow()
})

test("migrate creates the schema once", () => {
  const db = memoryDb()
  migrate(db)
  expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 1 })
  expect(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get()).toEqual({ n: 10 })
})

test("syncProjects upserts, marks missing projects removed and reactivates them", () => {
  const db = memoryDb()
  syncProjects(db, [{ id: "101", name: "Formbuilder" }, { id: "102", name: "CRM" }], 1000)
  syncProjects(db, [{ id: "101", name: "Formbuilder v2" }], 2000)
  expect(listProjects(db).map((p) => [p.id, p.name, p.memberStatus, p.fetchedAt])).toEqual([
    ["102", "CRM", "removed", 2000],
    ["101", "Formbuilder v2", "active", 2000],
  ])
  syncProjects(db, [{ id: "101", name: "Formbuilder v2" }, { id: "102", name: "CRM" }], 3000)
  expect(listProjects(db).every((p) => p.memberStatus === "active")).toBe(true)
})

test("listSessions returns only live sessions of the project, newest first", () => {
  const db = memoryDb()
  syncProjects(db, [{ id: "101", name: "Formbuilder" }, { id: "102", name: "CRM" }], 1000)
  const insert = db.prepare("INSERT INTO sessions (id, project_id, directory, title, created_at, updated_at, deleted_at) VALUES (?, ?, '/repo', ?, 1, ?, ?)")
  insert.run("s1", "101", "Old", 10, null)
  insert.run("s2", "101", "New", 20, null)
  insert.run("s3", "101", "Deleted", 30, 31)
  insert.run("s4", "102", "Other project", 40, null)
  expect(listSessions(db, "101").map((s) => s.id)).toEqual(["s2", "s1"])
})

test("searchSessions matches title or message text and returns a snippet around the hit", () => {
  const db = memoryDb()
  syncProjects(db, [{ id: "101", name: "Formbuilder" }])
  const session = db.prepare("INSERT INTO sessions (id, project_id, directory, title, created_at, updated_at) VALUES (?, '101', '/tmp', ?, 1, 1)")
  session.run("s1", "Fix logo")
  session.run("s2", "Untitled")
  session.run("s3", "100% done")
  db.prepare("INSERT INTO messages (session_id, seq, role, parts_json, updated_at) VALUES ('s2', 1, 'user', ?, 1)")
    .run(JSON.stringify({ v: 1, parts: [{ type: "text", text: "Please read the attached spreadsheet first, then import customers from Excel" }] }))
  expect(searchSessions(db, "LOGO")).toEqual([{ id: "s1", snippet: null }])
  expect(searchSessions(db, "excel")).toEqual([{ id: "s2", snippet: "…customers from Excel" }])
  expect(searchSessions(db, "%")).toEqual([{ id: "s3", snippet: null }])
  db.prepare("UPDATE sessions SET deleted_at = 2 WHERE id = 's2'").run()
  expect(searchSessions(db, "excel")).toEqual([])
  syncProjects(db, [])
  expect(searchSessions(db, "LOGO")).toEqual([])
})

test("createSession, renameSession and deleteSession persist to the sidebar list", () => {
  const db = memoryDb()
  syncProjects(db, [{ id: "101", name: "Formbuilder" }])
  const created = createSession(db, "101", "/home", "New chat #1", 1000)
  expect(listSessions(db, "101")).toEqual([created])
  renameSession(db, created.id, "Fix logo")
  expect(listSessions(db, "101")[0]?.title).toBe("Fix logo")
  deleteSession(db, created.id, 2000)
  expect(listSessions(db, "101")).toEqual([])
  expect(() => createSession(db, "missing", "/home", "x")).toThrow()
})

test("searchSessions caps the snippet length", () => {
  const db = memoryDb()
  syncProjects(db, [{ id: "101", name: "Formbuilder" }])
  db.prepare("INSERT INTO sessions (id, project_id, directory, title, created_at, updated_at) VALUES ('s1', '101', '/tmp', 'Log', 1, 1)").run()
  db.prepare("INSERT INTO messages (session_id, seq, role, parts_json, updated_at) VALUES ('s1', 1, 'assistant', ?, 1)")
    .run(JSON.stringify({ v: 1, parts: [{ type: "text", text: `error found ${"x".repeat(5000)}` }] }))
  expect(searchSessions(db, "error")[0]?.snippet?.length).toBe(160)
})
