import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"
import { encodeParts, type StoredMessagePart } from "../../src/contracts/message-parts"
import {
  isAllowedArtifactPath,
  listSessionHistory,
  openAllowedMediaPath,
  parseMediaProtocolUrl,
  parseMediaSha256,
  readReferencedMediaBlob,
} from "../../src/desktop/main/message-store"
import { toStoredMedia } from "../../src/harness/context/media"
import { SqliteTurnStore } from "../../src/harness/session/sqlite-turn-store"
import { MIGRATIONS } from "../../src/infrastructure/db/migrations"
import { configureConnection, migrate, type Db } from "../../src/infrastructure/db/sqlite"

function memoryDb(migrations?: readonly string[]): Db {
  const db = new Database(":memory:") as unknown as Db
  configureConnection(db)
  migrate(db, undefined, migrations)
  return db
}

function seedSession(db: Db, sessionId = "s1"): void {
  db.exec("INSERT OR IGNORE INTO projects (id, key, name, fetched_at) VALUES ('p1', 'P-1', 'Project', 1)")
  db.prepare(`
    INSERT INTO sessions (id, project_id, directory, title, created_at, updated_at)
    VALUES (?, 'p1', '/repo', 'Chat', 1, 1)`).run(sessionId)
}

test("listSessionHistory returns a completed turn with assistant text and two tool calls without raw tool output", () => {
  const db = memoryDb()
  seedSession(db)
  let tick = 100
  const store = new SqliteTurnStore(db, () => ++tick)

  const { turn } = store.beginTurn({
    sessionId: "s1",
    clientRequestId: "req-1",
    prompt: "Check repo files",
    workspacePath: "/repo/app",
  })
  store.appendSteps(turn, [
    { type: "function_call", id: "fc-1", call_id: "c1", name: "read", arguments: "{\"path\":\"a.ts\"}" },
    { type: "function_call", id: "fc-2", call_id: "c2", name: "bash", arguments: "{\"command\":\"ls\"}" },
  ])
  store.appendSteps(turn, [
    { type: "function_call_output", call_id: "c1", output: "RAW_SECRET_OUTPUT" },
    { type: "function_call_output", call_id: "c2", output: "Tool error: permission denied" },
  ])
  store.finishTurn(turn, {
    items: [
      {
        type: "message",
        role: "assistant",
        content: [
          { type: "output_text", text: "Checked a.ts. " },
          { type: "output_text", text: "Bash was denied." },
        ],
      },
    ],
    state: "completed",
  })

  const history = listSessionHistory(db, "s1")
  expect(history).toEqual([
    {
      requestId: "req-1",
      userSeq: 1,
      assistantSeq: 2,
      state: "completed",
      workspacePath: "/repo/app",
      prompt: "Check repo files",
      assistantText: "Checked a.ts. Bash was denied.",
      toolCalls: [
        { callId: "c1", name: "read", status: "done" },
        { callId: "c2", name: "bash", status: "error" },
      ],
      media: [],
      errorMessage: null,
      updatedAt: tick,
    },
  ])
  expect(JSON.stringify(history)).not.toContain("RAW_SECRET_OUTPUT")
  expect(JSON.stringify(history)).not.toContain("permission denied")
})

test("listSessionHistory returns media references for blob images and document paths with no base64", () => {
  const db = memoryDb()
  seedSession(db)
  const store = new SqliteTurnStore(db, () => 500)

  const imageBytes = Buffer.from("png-binary-payload")
  const imageBase64 = imageBytes.toString("base64")
  const storedImage = toStoredMedia(
    [
      { type: "input_text", text: "Read file: shot.png (PNG image)." },
      { type: "input_image", image_url: `data:image/png;base64,${imageBase64}`, detail: "auto" },
    ],
    { path: "/repo/shot.png" },
  )
  const pdfBytes = Buffer.from("%PDF-1.7 sample document")
  const pdfBase64 = pdfBytes.toString("base64")
  const storedPdf = toStoredMedia(
    [{ type: "input_file", filename: "spec.pdf", file_data: `data:application/pdf;base64,${pdfBase64}` }],
    { path: "/repo/spec.pdf" },
  )

  const { turn } = store.beginTurn({
    sessionId: "s1",
    clientRequestId: "req-media",
    prompt: "Read screenshot and spec",
    workspacePath: "/repo",
  })
  store.appendSteps(
    turn,
    [
      { type: "function_call", id: "fc-1", call_id: "c1", name: "read", arguments: "{\"path\":\"shot.png\"}" },
      { type: "function_call_output", call_id: "c1", output: storedImage.parts } as StoredMessagePart,
      { type: "function_call", id: "fc-2", call_id: "c2", name: "read", arguments: "{\"path\":\"spec.pdf\"}" },
      { type: "function_call_output", call_id: "c2", output: storedPdf.parts } as StoredMessagePart,
    ],
    storedImage.blobs,
  )
  store.finishTurn(turn, {
    items: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Looks good." }] }],
    state: "completed",
  })

  const history = listSessionHistory(db, "s1")
  const serialized = JSON.stringify(history)
  expect(history).toHaveLength(1)
  expect(history[0]?.media).toEqual([
    {
      kind: "image",
      name: "shot.png",
      mime: "image/png",
      bytes: imageBytes.byteLength,
      sha256: storedImage.blobs[0]!.sha256,
    },
    {
      kind: "file",
      name: "spec.pdf",
      mime: "application/pdf",
      bytes: pdfBytes.byteLength,
      path: "/repo/spec.pdf",
    },
  ])
  expect(serialized).not.toContain(imageBase64)
  expect(serialized).not.toContain(pdfBase64)
  expect(serialized).not.toContain("data:image/")
  expect(serialized).not.toContain("data:application/")
})

test("listSessionHistory represents running and interrupted turns with pending tool calls", () => {
  const db = memoryDb()
  seedSession(db, "s-run")
  seedSession(db, "s-int")
  let tick = 1000
  const store = new SqliteTurnStore(db, () => ++tick)

  const running = store.beginTurn({
    sessionId: "s-run",
    clientRequestId: "req-run",
    prompt: "Still working",
    workspacePath: "/repo",
  })
  store.appendSteps(running.turn, [
    { type: "function_call", id: "fc-run", call_id: "c-run", name: "read", arguments: "{}" },
  ])

  expect(listSessionHistory(db, "s-run")).toEqual([
    {
      requestId: "req-run",
      userSeq: 1,
      assistantSeq: 2,
      state: "running",
      workspacePath: "/repo",
      prompt: "Still working",
      assistantText: "",
      toolCalls: [{ callId: "c-run", name: "read", status: "pending" }],
      media: [],
      errorMessage: null,
      updatedAt: tick,
    },
  ])

  const crashed = store.beginTurn({
    sessionId: "s-int",
    clientRequestId: "req-int",
    prompt: "Crashed mid-turn",
    workspacePath: "/repo",
  })
  store.appendSteps(crashed.turn, [
    { type: "function_call", id: "fc-int", call_id: "c-int", name: "bash", arguments: "{}" },
  ])
  store.recoverInterrupted()

  expect(listSessionHistory(db, "s-int")[0]).toMatchObject({
    requestId: "req-int",
    state: "interrupted",
    prompt: "Crashed mid-turn",
    toolCalls: [{ callId: "c-int", name: "bash", status: "pending" }],
    errorMessage: null,
  })
})

test("listSessionHistory decodes legacy v1 rows with null state and requestId", () => {
  const db = memoryDb(MIGRATIONS.slice(0, 1))
  seedSession(db)
  db.prepare(`
    INSERT INTO messages (session_id, seq, role, parts_json, updated_at)
    VALUES ('s1', 1, 'user', ?, 10),
           ('s1', 2, 'assistant', ?, 20)`).run(
    encodeParts([{ type: "text", text: "legacy prompt" }]),
    encodeParts([{ type: "text", text: "legacy answer" }]),
  )
  migrate(db)

  expect(listSessionHistory(db, "s1")).toEqual([
    {
      requestId: null,
      userSeq: 1,
      assistantSeq: 2,
      state: null,
      workspacePath: null,
      prompt: "legacy prompt",
      assistantText: "legacy answer",
      toolCalls: [],
      media: [],
      errorMessage: null,
      updatedAt: 20,
    },
  ])
})

test("listSessionHistory isolates a corrupt parts_json row without failing neighboring turns", () => {
  const db = memoryDb()
  seedSession(db)
  const store = new SqliteTurnStore(db, () => 300)

  const t1 = store.beginTurn({ sessionId: "s1", clientRequestId: "req-1", prompt: "First", workspacePath: "/repo" })
  store.finishTurn(t1.turn, {
    items: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "First ok" }] }],
    state: "completed",
  })

  const t2 = store.beginTurn({ sessionId: "s1", clientRequestId: "req-corrupt", prompt: "Broken turn", workspacePath: "/repo" })
  store.finishTurn(t2.turn, {
    items: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Placeholder" }] }],
    state: "completed",
  })

  const t3 = store.beginTurn({ sessionId: "s1", clientRequestId: "req-3", prompt: "Third", workspacePath: "/repo" })
  store.finishTurn(t3.turn, {
    items: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Third ok" }] }],
    state: "completed",
  })

  // Passes SQLite envelope CHECK but fails message-parts schema validation
  db.prepare("UPDATE messages SET parts_json = ? WHERE session_id = 's1' AND seq = 4").run(
    JSON.stringify({ v: 1, parts: [{ type: "function_call", call_id: 123 }] }),
  )

  const history = listSessionHistory(db, "s1")
  expect(history).toHaveLength(3)
  expect(history[0]).toMatchObject({ requestId: "req-1", state: "completed", prompt: "First", assistantText: "First ok" })
  expect(history[1]).toEqual({
    requestId: "req-corrupt",
    userSeq: 3,
    assistantSeq: 4,
    state: "failed",
    workspacePath: "/repo",
    prompt: "",
    assistantText: "",
    toolCalls: [],
    media: [],
    errorMessage: "This turn could not be read.",
    updatedAt: 300,
  })
  expect(history[2]).toMatchObject({ requestId: "req-3", state: "completed", prompt: "Third", assistantText: "Third ok" })
})

test("parseMediaSha256 and parseMediaProtocolUrl validate 64-char hex hashes and ccodex-media URLs", () => {
  const hash = createHash("sha256").update("hello").digest("hex")
  expect(parseMediaSha256(hash)).toBe(hash)
  expect(parseMediaSha256(hash.toUpperCase())).toBe(hash)
  expect(parseMediaSha256(hash.slice(0, 63))).toBeNull()
  expect(parseMediaSha256(`${hash}a`)).toBeNull()
  expect(parseMediaSha256(`g${hash.slice(1)}`)).toBeNull()

  expect(parseMediaProtocolUrl(`ccodex-media://${hash}`)).toBe(hash)
  expect(parseMediaProtocolUrl(`ccodex-media://${hash}/`)).toBe(hash)
  expect(parseMediaProtocolUrl(`ccodex-media://${hash.toUpperCase()}`)).toBe(hash)
  expect(parseMediaProtocolUrl(`https://${hash}`)).toBeNull()
  expect(parseMediaProtocolUrl(`ccodex-media://${hash}/extra`)).toBeNull()
  expect(parseMediaProtocolUrl(`ccodex-media://${hash}?a=1`)).toBeNull()
  expect(parseMediaProtocolUrl(`ccodex-media://${hash}#frag`)).toBeNull()
  expect(parseMediaProtocolUrl("ccodex-media://not-a-hash")).toBeNull()
  expect(parseMediaProtocolUrl("not a url")).toBeNull()
})

test("readReferencedMediaBlob serves only blobs referenced by artifacts", () => {
  const db = memoryDb()
  seedSession(db)

  const referenced = Buffer.from("referenced-png")
  const orphan = Buffer.from("orphan-png")
  const referencedHash = createHash("sha256").update(referenced).digest("hex")
  const orphanHash = createHash("sha256").update(orphan).digest("hex")

  db.prepare("INSERT INTO media_blob (sha256, mime, bytes, data, created_at) VALUES (?, 'image/png', ?, ?, 1)")
    .run(referencedHash, referenced.byteLength, referenced)
  db.prepare("INSERT INTO media_blob (sha256, mime, bytes, data, created_at) VALUES (?, 'image/png', ?, ?, 1)")
    .run(orphanHash, orphan.byteLength, orphan)

  const message = db.prepare(`
    INSERT INTO messages (session_id, seq, role, parts_json, updated_at, state)
    VALUES ('s1', 1, 'assistant', '{"v":1,"parts":[]}', 1, 'completed')`).run()
  db.prepare(`
    INSERT INTO artifacts (message_id, direction, path, name, mime_type, size_bytes, created_at, sha256)
    VALUES (?, 'out', ?, 'shot.png', 'image/png', ?, 1, ?)`).run(
    message.lastInsertRowid,
    `media:${referencedHash}`,
    referenced.byteLength,
    referencedHash,
  )

  const found = readReferencedMediaBlob(db, referencedHash.toUpperCase())
  expect(found?.mime).toBe("image/png")
  expect(Buffer.from(found!.data)).toEqual(referenced)
  expect(readReferencedMediaBlob(db, orphanHash)).toBeNull()
  expect(readReferencedMediaBlob(db, "0".repeat(64))).toBeNull()
  expect(readReferencedMediaBlob(db, "invalid")).toBeNull()
})

test("isAllowedArtifactPath and openAllowedMediaPath allow only existing absolute paths in artifacts", async () => {
  const db = memoryDb()
  seedSession(db)
  const dir = mkdtempSync(join(tmpdir(), "ccodex-media-open-"))
  const existingPath = join(dir, "spec.pdf")
  const deletedPath = join(dir, "gone.pdf")
  const unreferencedPath = join(dir, "secret.txt")
  writeFileSync(existingPath, "%PDF-1.7")
  writeFileSync(unreferencedPath, "secret")

  try {
    const message = db.prepare(`
      INSERT INTO messages (session_id, seq, role, parts_json, updated_at, state)
      VALUES ('s1', 1, 'assistant', '{"v":1,"parts":[]}', 1, 'completed')`).run()
    const insertArtifact = db.prepare(`
      INSERT INTO artifacts (message_id, direction, path, name, mime_type, size_bytes, created_at, sha256)
      VALUES (?, 'out', ?, ?, 'application/pdf', 8, 1, ?)`)
    insertArtifact.run(message.lastInsertRowid, existingPath, "spec.pdf", null)
    insertArtifact.run(message.lastInsertRowid, deletedPath, "gone.pdf", null)
    insertArtifact.run(message.lastInsertRowid, "relative/spec.pdf", "spec.pdf", null)
    insertArtifact.run(message.lastInsertRowid, `media:${"a".repeat(64)}`, "shot.png", "a".repeat(64))

    expect(isAllowedArtifactPath(db, existingPath)).toBe(true)
    expect(isAllowedArtifactPath(db, unreferencedPath)).toBe(false)
    expect(isAllowedArtifactPath(db, "relative/spec.pdf")).toBe(false)
    expect(isAllowedArtifactPath(db, `media:${"a".repeat(64)}`)).toBe(false)
    expect(isAllowedArtifactPath(db, `${existingPath}\0`)).toBe(false)
    expect(isAllowedArtifactPath(db, "")).toBe(false)
    expect(isAllowedArtifactPath(db, null)).toBe(false)

    const opened: string[] = []
    const okOpen = async (target: string) => {
      opened.push(target)
      return ""
    }

    expect(await openAllowedMediaPath(db, existingPath, okOpen)).toEqual({ ok: true })
    expect(opened).toEqual([existingPath])
    expect(await openAllowedMediaPath(db, deletedPath, okOpen)).toEqual({ ok: false, error: "missing" })
    expect(await openAllowedMediaPath(db, unreferencedPath, okOpen)).toEqual({ ok: false, error: "not-allowed" })
    expect(await openAllowedMediaPath(db, "relative/spec.pdf", okOpen)).toEqual({ ok: false, error: "not-allowed" })
    expect(await openAllowedMediaPath(db, existingPath, async () => "No handler")).toEqual({ ok: false, error: "missing" })
    expect(opened).toEqual([existingPath])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
