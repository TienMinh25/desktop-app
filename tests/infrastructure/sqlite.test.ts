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

test("configureConnection turns on foreign keys so ON DELETE CASCADE works", () => {
  expect(memoryDb().prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 })
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
  expect(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get()).toEqual({ n: 10 })
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
const SHIPPED_SHA256 = ["cb4274473d5a28335d5d63f7ff71d89e247de91b8920c9817ef61644eee42cfd"]

test("shipped migrations are never edited or deleted", () => {
  const hashes = MIGRATIONS.map((sql) => createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex"))
  expect(hashes.slice(0, SHIPPED_SHA256.length)).toEqual(SHIPPED_SHA256)
})
