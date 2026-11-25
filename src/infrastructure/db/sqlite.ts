import Database from "better-sqlite3"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { MIGRATIONS } from "./migrations"

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
export function migrate(db: Db, backupDirectory?: string, migrations: readonly string[] = MIGRATIONS): void {
  const current = userVersion(db)
  const latest = migrations.length
  if (current > latest) {
    throw new Error(`Local database is version ${current} but this app knows up to ${latest}. Install the newer app or restore a file from ${backupDirectory ?? "the backups folder"}.`)
  }
  if (current === latest) return
  if (current > 0 && backupDirectory) backupDb(db, backupDirectory, current)
  for (let version = current; version < latest; version++) {
    db.transaction(() => {
      db.exec(migrations[version]!)
      db.exec(`PRAGMA user_version = ${version + 1}`)
    }).immediate()
  }
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
