import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { mkdtempSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MIGRATIONS, type Migration } from "../../src/infrastructure/db/migrations"
import { configureConnection, migrate, userVersion, type Db } from "../../src/infrastructure/db/sqlite"

function step(version: number, sql: string): Migration {
  return { version, name: `000${version}_test`, sql }
}

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
  const v1 = step(1, "CREATE TABLE a (id INTEGER PRIMARY KEY);")
  migrate(db, backups, [v1])
  expect(readdirSync(dir)).not.toContain("backups")
  migrate(db, backups, [v1, step(2, "ALTER TABLE a ADD COLUMN note TEXT;")])
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
  expect(() => migrate(db, undefined, [...MIGRATIONS, step(MIGRATIONS.length + 1, "ALTER TABLE projects ADD COLUMN x TEXT; SELECT * FROM missing_table;")])).toThrow()
  expect(userVersion(db)).toBe(MIGRATIONS.length)
  expect(db.prepare("SELECT count(*) AS n FROM pragma_table_info('projects') WHERE name = 'x'").get()).toEqual({ n: 0 })
})

test("migrate refuses a database newer than the app", () => {
  const db = memoryDb()
  db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`)
  expect(() => migrate(db)).toThrow("newer app")
})

test("migrate refuses a migration list with a deleted or reordered entry", () => {
  const db = memoryDb()
  expect(() => migrate(db, undefined, [step(1, "SELECT 1;"), step(3, "SELECT 3;")])).toThrow("deleted or reordered")
  expect(() => migrate(db, undefined, [step(2, "SELECT 2;"), step(1, "SELECT 1;")])).toThrow("deleted or reordered")
})

test("migrate refuses an applied migration whose SQL was edited", () => {
  const db = memoryDb()
  const v2 = step(MIGRATIONS.length + 1, "CREATE TABLE extra (id INTEGER PRIMARY KEY);")
  migrate(db, undefined, [...MIGRATIONS, v2])
  expect(() => migrate(db, undefined, [...MIGRATIONS, { ...v2, sql: v2.sql + " -- edited" }])).toThrow("changed after it was applied")
  expect(() => migrate(db, undefined, [...MIGRATIONS, { ...v2, sql: v2.sql.replace(/\n/g, "\r\n") }])).not.toThrow()
})

test("migrate refuses a database that lost the record of an applied migration", () => {
  const db = memoryDb()
  const v2 = step(MIGRATIONS.length + 1, "CREATE TABLE extra (id INTEGER PRIMARY KEY);")
  migrate(db, undefined, [...MIGRATIONS, v2])
  db.exec(`DELETE FROM schema_migrations WHERE version = ${v2.version}`)
  expect(() => migrate(db, undefined, [...MIGRATIONS, v2])).toThrow("no record of migration")
})

test("migrate records existing versions once for a database made before schema_migrations", () => {
  const db = memoryDb()
  db.exec("DROP TABLE schema_migrations")
  migrate(db)
  expect(db.prepare("SELECT version, name FROM schema_migrations").all()).toEqual([{ version: 1, name: "0001_init" }])
  expect(() => migrate(db, undefined, [{ ...MIGRATIONS[0]!, sql: "-- edited" }])).toThrow("changed after it was applied")
})
