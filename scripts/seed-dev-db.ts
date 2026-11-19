import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { dbPath, migrate, syncProjects, type Db } from "../src/desktop/main/db"

// Usage: bun scripts/seed-dev-db.ts [ldap] [appName], appName "Electron" for bun run dev, "C-CodeX Desktop" for a build
const ldap = process.argv[2] ?? "local"
const appName = process.argv[3] ?? "Electron"
const appData = process.platform === "win32" ? process.env.APPDATA!
  : process.platform === "darwin" ? join(homedir(), "Library", "Application Support")
  : join(homedir(), ".config")
const path = dbPath(join(appData, appName), ldap)
mkdirSync(dirname(path), { recursive: true })

const db = new Database(path) as unknown as Db
migrate(db)
const now = Date.now()
syncProjects(db, [{ id: "demo-1", name: "Demo: CMC Formbuilder" }, { id: "demo-2", name: "Demo: CRM" }], now)
const insert = db.prepare(`
  INSERT OR REPLACE INTO sessions (id, project_id, directory, title, last_preview, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)`)
insert.run("demo-s1", "demo-1", homedir(), "Fix logo alignment in PDF", "Logo now aligns to the left margin.", now - 7_200_000, now - 3_600_000)
insert.run("demo-s2", "demo-1", homedir(), "Review DB schema", null, now - 600_000, now - 60_000)
insert.run("demo-s3", "demo-2", homedir(), "Customer import script", null, now - 86_400_000, now - 86_400_000)
const message = db.prepare("INSERT OR REPLACE INTO messages (session_id, seq, role, parts_json, updated_at) VALUES (?, ?, ?, ?, ?)")
const text = (value: string) => JSON.stringify({ v: 1, parts: [{ type: "text", text: value }] })
message.run("demo-s1", 1, "user", text("The logo in the invoice PDF is shifted to the right"), now - 7_200_000)
message.run("demo-s1", 2, "assistant", text("Logo now aligns to the left margin."), now - 3_600_000)
message.run("demo-s3", 1, "user", text("Write a script to import customers from the Excel file"), now - 86_400_000)
db.close()
console.log(`Seeded ${path}`)
