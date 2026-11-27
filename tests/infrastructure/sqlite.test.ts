import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { expect, test } from "bun:test"
import { mkdtempSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MIGRATIONS } from "../../src/infrastructure/db/migrations"
import { configureConnection, migrate, userVersion, type Db } from "../../src/infrastructure/db/sqlite"

function memoryDb(): Db {
  const db = new Database(":memory:") as unknown as Db
  configureConnection(db)
  migrate(db)
  return db
}

test("configureConnection turns on foreign keys and supports NORMAL and FULL synchronous modes", () => {
  const normalDb = memoryDb()
  expect(normalDb.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 })
  expect(normalDb.prepare("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 })
  expect(normalDb.prepare("PRAGMA synchronous").get()).toEqual({ synchronous: 1 })

  const fullDb = new Database(":memory:") as unknown as Db
  configureConnection(fullDb, { synchronous: "FULL" })
  expect(fullDb.prepare("PRAGMA synchronous").get()).toEqual({ synchronous: 2 })
})

test("permission_mode accepts only the three approval modes", () => {
  const db = memoryDb()
  db.exec("INSERT INTO projects (id, key, name, fetched_at) VALUES ('1', 'P-1', 'A', 1)")
  db.exec("INSERT INTO sessions (id, project_id, directory, title, created_at, updated_at) VALUES ('s', '1', '/', 't', 1, 1)")
  db.exec("INSERT INTO session_config (session_id, provider_id, model_id) VALUES ('s', 1, 1)")
  expect(db.prepare("SELECT permission_mode FROM session_config").get()).toEqual({ permission_mode: "manual" })
  expect(() => db.exec("UPDATE session_config SET permission_mode = 'ask'")).toThrow()
})

test("migrate creates the schema once", () => {
  const db = memoryDb()
  migrate(db)
  expect(userVersion(db)).toBe(MIGRATIONS.length)
  expect(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get()).toEqual({ n: 11 })
})

function fileDb(dir: string): Db {
  const db = new Database(join(dir, "ccodex.db")) as unknown as Db
  configureConnection(db)
  return db
}

test("migrate runs only the missing versions and backs up the old file first", () => {
  const dir = mkdtempSync(join(tmpdir(), "ccodex-db-"))
  const backups = join(dir, "backups")
  const db = fileDb(dir)
  const v1 = "CREATE TABLE a (id INTEGER PRIMARY KEY);"
  migrate(db, backups, [v1])
  expect(readdirSync(dir)).not.toContain("backups")
  migrate(db, backups, [v1, "ALTER TABLE a ADD COLUMN note TEXT;"])
  expect(userVersion(db)).toBe(2)
  expect(db.prepare("SELECT name FROM pragma_table_info('a')").all()).toEqual([{ name: "id" }, { name: "note" }])
  const [backup] = readdirSync(backups)
  expect(backup).toStartWith("ccodex.v1.")
  const old = new Database(join(backups, backup!))
  expect(old.prepare("PRAGMA user_version").get()).toEqual({ user_version: 1 })
  expect(old.prepare("SELECT count(*) AS n FROM pragma_table_info('a')").get()).toEqual({ n: 1 })
})

test("a failing migration leaves the previous version untouched", () => {
  const db = memoryDb()
  expect(() => migrate(db, undefined, [...MIGRATIONS, "ALTER TABLE projects ADD COLUMN x TEXT; SELECT * FROM missing_table;"])).toThrow()
  expect(userVersion(db)).toBe(MIGRATIONS.length)
  expect(db.prepare("SELECT count(*) AS n FROM pragma_table_info('projects') WHERE name = 'x'").get()).toEqual({ n: 0 })
})

test("migrate refuses a database newer than the app", () => {
  const db = memoryDb()
  db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`)
  expect(() => migrate(db)).toThrow("newer app")
})

// Add the hash of each new migration here, editing or deleting a shipped one fails this test
const SHIPPED_SHA256 = [
  "cb4274473d5a28335d5d63f7ff71d89e247de91b8920c9817ef61644eee42cfd",
  "7099ac8589321cef580f31998850d3238bededf272390d4a4caa52c01de92a86",
]

test("shipped migrations are never edited or deleted", () => {
  const hashes = MIGRATIONS.map((sql) => createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex"))
  expect(hashes.slice(0, SHIPPED_SHA256.length)).toEqual(SHIPPED_SHA256)
})

function seedSession(db: Db, sessionId = "s1") {
  db.exec("INSERT OR IGNORE INTO projects (id, key, name, fetched_at) VALUES ('p1', 'P-1', 'Project', 1)")
  db.prepare("INSERT INTO sessions (id, project_id, directory, title, created_at, updated_at) VALUES (?, 'p1', '/tmp', 't', 1, 1)").run(sessionId)
}

test("migrate v0 to v2 adds turn state columns, media_blob, and artifacts.sha256", () => {
  const db = memoryDb()
  expect(userVersion(db)).toBe(2)

  const messageColumns = (db.prepare("SELECT name FROM pragma_table_info('messages')").all() as Array<{ name: string }>).map((row) => row.name)
  expect(messageColumns).toContain("state")
  expect(messageColumns).toContain("client_request_id")
  expect(messageColumns).toContain("error_message")
  expect(messageColumns).toContain("workspace_path")

  const artifactColumns = (db.prepare("SELECT name FROM pragma_table_info('artifacts')").all() as Array<{ name: string }>).map((row) => row.name)
  expect(artifactColumns).toContain("sha256")

  const blobColumns = (db.prepare("SELECT name FROM pragma_table_info('media_blob')").all() as Array<{ name: string }>).map((row) => row.name)
  expect(blobColumns).toEqual(["sha256", "mime", "bytes", "width", "height", "data", "created_at"])
})

test("migrate v1 to v2 preserves existing message rows with NULL state", () => {
  const db = new Database(":memory:") as unknown as Db
  configureConnection(db)
  migrate(db, undefined, [MIGRATIONS[0]!])
  seedSession(db, "s1")
  db.exec(`INSERT INTO messages (session_id, seq, role, parts_json, updated_at) VALUES ('s1', 1, 'user', '{"v":1,"parts":[{"type":"text","text":"hi"}]}', 1)`)

  migrate(db, undefined, MIGRATIONS)
  expect(userVersion(db)).toBe(2)
  expect(
    db.prepare("SELECT state, client_request_id, error_message, workspace_path FROM messages WHERE session_id = 's1' AND seq = 1").get(),
  ).toEqual({
    state: null,
    client_request_id: null,
    error_message: null,
    workspace_path: null,
  })
})

test("only the assistant row owns the turn state and session-scoped request ID", () => {
  const db = memoryDb()
  seedSession(db, "s1")
  seedSession(db, "s2")
  const insert = db.prepare(`
    INSERT INTO messages (session_id, seq, role, parts_json, updated_at, state, client_request_id)
    VALUES (?, ?, ?, '{"v":1,"parts":[]}', 1, ?, ?)
  `)
  insert.run("s1", 1, "user", null, null)
  insert.run("s1", 2, "assistant", "running", "req-1")
  insert.run("s1", 3, "user", null, null)

  expect(() => insert.run("s1", 4, "assistant", "running", "req-2")).toThrow(/UNIQUE/)
  expect(() => insert.run("s1", 4, "assistant", "completed", "req-1")).toThrow(/UNIQUE/)
  expect(() => insert.run("s1", 4, "user", null, "unused-id")).toThrow(/CHECK/)
  expect(() => insert.run("s1", 4, "user", "completed", null)).toThrow(/CHECK/)
  insert.run("s2", 1, "user", null, null)
  insert.run("s2", 2, "assistant", "running", "req-1")

  const failTurn = db.prepare("UPDATE messages SET state = 'failed', error_message = ? WHERE session_id = 's1' AND seq = 2")
  expect(() => failTurn.run("x".repeat(501))).toThrow(/CHECK/)
  failTurn.run("x".repeat(500))
  insert.run("s1", 4, "assistant", "running", "req-2")
})
