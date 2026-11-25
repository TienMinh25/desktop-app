import Database from "better-sqlite3"
import { createHash } from "node:crypto"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { MIGRATIONS, type Migration } from "./migrations"

export type Db = Database.Database

// One DB per machine (one employee per machine by company policy), next to the other files in ~/.ccodex
export function openDb(ccodexDirectory: string): Db {
  mkdirSync(ccodexDirectory, { recursive: true })
  const db = new Database(join(ccodexDirectory, "ccodex.db"))
  configureConnection(db)
  return db
}

// These pragmas hold per connection, so every process runs them on every open
// WAL + busy_timeout let main and harness use the file at the same time, foreign_keys makes ON DELETE CASCADE work
export function configureConnection(db: Db): void {
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")
}

// Only main calls this, once at startup before the harness opens the DB
// user_version is a number stored in the SQLite file header: 0 = new file, N = schema version N
// Each migration and its user_version bump commit together, so a crash never leaves a half applied version
export function migrate(db: Db, backupDirectory?: string, migrations: readonly Migration[] = MIGRATIONS): void {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(`Migration list is broken at ${migration.name}: expected version ${index + 1}, got ${migration.version}. A migration was deleted or reordered.`)
    }
  })
  const current = userVersion(db)
  const latest = migrations.length
  if (current > latest) {
    throw new Error(`Local database is version ${current} but this app knows up to ${latest}. Install the newer app or restore a file from ${backupDirectory ?? "the backups folder"}.`)
  }
  checkApplied(db, migrations.slice(0, current))
  if (current === latest) return
  if (current > 0 && backupDirectory) backupDb(db, backupDirectory, current)
  for (const migration of migrations.slice(current)) {
    db.transaction(() => {
      db.exec(migration.sql)
      recordApplied(db, migration)
      db.exec(`PRAGMA user_version = ${migration.version}`)
    }).immediate()
  }
}

// Every applied migration must still exist in code with the same content
function checkApplied(db: Db, applied: readonly Migration[]): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL) STRICT")
  const rows = db.prepare("SELECT version, checksum FROM schema_migrations").all() as { version: number; checksum: string }[]
  // DBs created before this table existed have no rows, so trust the code once
  if (rows.length === 0) {
    db.transaction(() => applied.forEach((migration) => recordApplied(db, migration)))()
    return
  }
  for (const migration of applied) {
    const row = rows.find((r) => r.version === migration.version)
    if (!row) throw new Error(`Local database has no record of migration ${migration.name}. Restore a file from the backups folder.`)
    if (row.checksum !== checksum(migration.sql)) {
      throw new Error(`Migration ${migration.name} changed after it was applied. Revert that file and add a new migration instead.`)
    }
  }
}

function recordApplied(db: Db, migration: Migration): void {
  db.prepare("INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)")
    .run(migration.version, migration.name, checksum(migration.sql), Date.now())
}

// CRLF from a Windows checkout must not count as an edit
function checksum(sql: string): string {
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex")
}

export function userVersion(db: Db): number {
  return (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version
}

// Restoring this file is the way back, an older app cannot undo a newer schema
// shortcut: old backups are never pruned, add pruning if version bumps become frequent
export function backupDb(db: Db, backupDirectory: string, version: number, now = Date.now()): string {
  mkdirSync(backupDirectory, { recursive: true })
  const path = join(backupDirectory, `ccodex.v${version}.${now}.db`)
  db.prepare("VACUUM INTO ?").run(path)
  return path
}
