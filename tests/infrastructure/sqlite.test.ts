import { Database } from "bun:sqlite"
import { join } from "node:path"
import { expect, test } from "bun:test"
import { ccodexDbPath, migrate, type Db } from "../../src/infrastructure/db/sqlite"

function memoryDb(): Db {
  const db = new Database(":memory:") as unknown as Db
  migrate(db)
  return db
}

test("ccodexDbPath puts the DB next to the other app files", () => {
  expect(ccodexDbPath("/home/u")).toBe(join("/home/u", ".ccodex", "ccodex.db"))
})

test("migrate creates the schema once", () => {
  const db = memoryDb()
  migrate(db)
  expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 1 })
  expect(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get()).toEqual({ n: 10 })
})
