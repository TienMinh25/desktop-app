import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { configureConnection, migrate, type Db } from "../../src/infrastructure/db/sqlite"

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
  expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 1 })
  expect(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get()).toEqual({ n: 10 })
})
