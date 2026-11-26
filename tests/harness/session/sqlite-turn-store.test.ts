import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { describe, expect, it } from "bun:test"
import { MessagePartsError, type StoredMessagePart } from "../../../src/contracts/message-parts"
import { toStoredMedia } from "../../../src/harness/context/media"
import { InMemoryTurnStore } from "../../../src/harness/session/in-memory-turn-store"
import { SqliteTurnStore } from "../../../src/harness/session/sqlite-turn-store"
import {
  mediaArtifacts,
  TurnConflictError,
  TurnGoneError,
  type TurnStore,
} from "../../../src/harness/session/turn-store"
import { MIGRATIONS } from "../../../src/infrastructure/db/migrations"
import { configureConnection, migrate, type Db } from "../../../src/infrastructure/db/sqlite"

interface StoreHarness {
  store: TurnStore
  createSession(sessionId: string): void
  deleteSession(sessionId: string): void
  getArtifactRows(sessionId: string, assistantMessageId: number): Array<{
    direction: string
    path: string
    name: string
    mime_type: string
    size_bytes: number
    sha256: string | null
  }>
  getTurnRow(sessionId: string, assistantMessageId: number): {
    state: string | null
    error_message: string | null
    workspace_path: string | null
  } | null
}

function createSqliteHarness(migrations?: readonly string[]): { harness: StoreHarness; db: Db } {
  const db = new Database(":memory:") as unknown as Db
  configureConnection(db)
  migrate(db, undefined, migrations)
  db.exec("INSERT INTO projects (id, key, name, fetched_at) VALUES ('p1', 'P-1', 'Project', 1)")

  let tick = 1_000
  const store = new SqliteTurnStore(db, () => ++tick)
  const harness: StoreHarness = {
    store,
    createSession(sessionId) {
      db.prepare(`
        INSERT INTO sessions (id, project_id, directory, title, created_at, updated_at)
        VALUES (?, 'p1', '/repo', 'Chat', 1, 1)`).run(sessionId)
    },
    deleteSession(sessionId) {
      db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId)
    },
    getArtifactRows(_sessionId, assistantMessageId) {
      return db.prepare(`
        SELECT direction, path, name, mime_type, size_bytes, sha256
        FROM artifacts
        WHERE message_id = ?
        ORDER BY id ASC`).all(assistantMessageId) as Array<{
        direction: string
        path: string
        name: string
        mime_type: string
        size_bytes: number
        sha256: string | null
      }>
    },
    getTurnRow(sessionId, assistantMessageId) {
      const row = db.prepare(`
        SELECT state, error_message, workspace_path
        FROM messages
        WHERE id = ? AND session_id = ?`).get(assistantMessageId, sessionId) as {
        state: string | null
        error_message: string | null
        workspace_path: string | null
      } | undefined
      return row ?? null
    },
  }
  return { harness, db }
}

function createInMemoryHarness(): StoreHarness {
  const store = new InMemoryTurnStore()
  return {
    store,
    createSession() {},
    deleteSession(sessionId) {
      store.deleteSession(sessionId)
    },
    getArtifactRows(sessionId, assistantMessageId) {
      return store.getArtifacts(sessionId, assistantMessageId).map((artifact) => ({
        direction: artifact.direction,
        path: artifact.path,
        name: artifact.name,
        mime_type: artifact.mimeType,
        size_bytes: artifact.sizeBytes,
        sha256: artifact.sha256,
      }))
    },
    getTurnRow(sessionId, assistantMessageId) {
      const meta = store.getTurnMetadata(sessionId, assistantMessageId)
      if (!meta) return null
      return {
        state: meta.state,
        error_message: meta.errorMessage,
        workspace_path: meta.workspacePath,
      }
    },
  }
}

function runTurnStoreSuite(name: string, createHarness: () => StoreHarness) {
  describe(name, () => {
    it("round-trips begin, appendSteps, and finishTurn into subsequent history", () => {
      const h = createHarness()
      h.createSession("s1")

      const first = h.store.beginTurn({
        sessionId: "s1",
        clientRequestId: "req-1",
        prompt: "Check file",
        workspacePath: "/repo/a",
      })
      expect(first.history).toEqual([])
      expect(first.turn).toMatchObject({
        sessionId: "s1",
        userSeq: 1,
        assistantSeq: 2,
        clientRequestId: "req-1",
        workspacePath: "/repo/a",
        state: "running",
      })

      const callItem: StoredMessagePart = {
        type: "function_call",
        id: "fc-1",
        call_id: "call-1",
        name: "read",
        arguments: "{\"path\":\"a.ts\"}",
      }
      const outputItem: StoredMessagePart = {
        type: "function_call_output",
        call_id: "call-1",
        output: "const x = 1",
      }
      const replyItem: StoredMessagePart = {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Done." }],
      }

      h.store.appendSteps(first.turn, [callItem])
      h.store.appendSteps(first.turn, [outputItem])
      h.store.appendSteps(first.turn, [{ type: "text", text: "Legacy assistant text" }])
      h.store.finishTurn(first.turn, { items: [replyItem], state: "completed" })
      expect(() => h.store.finishTurn(first.turn, { state: "failed" })).toThrow(TurnGoneError)

      expect(h.getTurnRow("s1", first.turn.assistantMessageId)).toEqual({
        state: "completed",
        error_message: null,
        workspace_path: "/repo/a",
      })

      const second = h.store.beginTurn({
        sessionId: "s1",
        clientRequestId: "req-2",
        prompt: "Follow up",
        workspacePath: "/repo/b",
      })
      expect(second.turn).toMatchObject({
        userSeq: 3,
        assistantSeq: 4,
        workspacePath: "/repo/b",
        state: "running",
      })
      expect(second.history).toEqual([
        {
          userSeq: 1,
          assistantSeq: 2,
          state: "completed",
          items: [
            { type: "message", role: "user", content: "Check file" },
            callItem,
            outputItem,
            { type: "message", role: "assistant", content: "Legacy assistant text" },
            replyItem,
          ],
        },
      ])
    })

    it("is idempotent when beginTurn is repeated with the same (sessionId, clientRequestId)", () => {
      const h = createHarness()
      h.createSession("s1")

      const t1 = h.store.beginTurn({
        sessionId: "s1",
        clientRequestId: "req-1",
        prompt: "First",
        workspacePath: "/repo",
      })
      h.store.finishTurn(t1.turn, {
        items: [{ type: "message", role: "assistant", content: "First reply" }],
        state: "completed",
      })

      const t2First = h.store.beginTurn({
        sessionId: "s1",
        clientRequestId: "req-2",
        prompt: "Second",
        workspacePath: "/repo",
      })
      const t2Retry = h.store.beginTurn({
        sessionId: "s1",
        clientRequestId: "req-2",
        prompt: "A retried input",
        workspacePath: "/elsewhere",
      })

      expect(t2Retry.turn).toEqual(t2First.turn)
      expect(t2Retry.history).toEqual(t2First.history)
      expect(t2Retry.history).toHaveLength(1)

      h.store.finishTurn(t2First.turn, { state: "completed" })
      const t3 = h.store.beginTurn({
        sessionId: "s1",
        clientRequestId: "req-3",
        prompt: "Third",
        workspacePath: "/repo",
      })
      expect(t3.turn.userSeq).toBe(5)
      expect(t3.history[1]?.items).toEqual([{ type: "message", role: "user", content: "Second" }])
      const completedRetry = h.store.beginTurn({
        sessionId: "s1",
        clientRequestId: "req-2",
        prompt: "Second",
        workspacePath: "/repo",
      })
      expect(completedRetry).toEqual({ ...t2Retry, turn: { ...t2Retry.turn, state: "completed" } })
    })

    it("rejects a second concurrent running turn in the same session with TurnConflictError", () => {
      const h = createHarness()
      h.createSession("s1")
      h.createSession("s2")

      h.store.beginTurn({
        sessionId: "s1",
        clientRequestId: "req-1",
        prompt: "Running",
        workspacePath: "/repo",
      })

      expect(() =>
        h.store.beginTurn({
          sessionId: "s1",
          clientRequestId: "req-2",
          prompt: "Concurrent",
          workspacePath: "/repo",
        }),
      ).toThrow(TurnConflictError)

      const otherSession = h.store.beginTurn({
        sessionId: "s2",
        clientRequestId: "req-1",
        prompt: "Other session",
        workspacePath: "/repo",
      })
      expect(otherSession.turn.state).toBe("running")
    })

    it("recovers running turns as interrupted and allows new turns afterward", () => {
      const h = createHarness()
      h.createSession("s1")
      h.createSession("s2")

      const t1 = h.store.beginTurn({
        sessionId: "s1",
        clientRequestId: "req-1",
        prompt: "Crash mid-turn",
        workspacePath: "/repo",
      })
      h.store.beginTurn({
        sessionId: "s2",
        clientRequestId: "req-1",
        prompt: "Crash too",
        workspacePath: "/repo",
      })

      expect(h.store.recoverInterrupted()).toBe(2)
      expect(h.store.recoverInterrupted()).toBe(0)
      expect(h.getTurnRow("s1", t1.turn.assistantMessageId)?.state).toBe("interrupted")
      expect(() => h.store.finishTurn(t1.turn, { state: "completed" })).toThrow(TurnGoneError)

      const next = h.store.beginTurn({
        sessionId: "s1",
        clientRequestId: "req-2",
        prompt: "After restart",
        workspacePath: "/repo",
      })
      expect(next.history).toEqual([
        {
          userSeq: 1,
          assistantSeq: 2,
          state: "interrupted",
          items: [{ type: "message", role: "user", content: "Crash mid-turn" }],
        },
      ])
    })

    it("rolls back finishTurn on error and truncates errorMessage to 500 characters", () => {
      const h = createHarness()
      h.createSession("s1")

      const { turn } = h.store.beginTurn({
        sessionId: "s1",
        clientRequestId: "req-1",
        prompt: "Work",
        workspacePath: "/repo",
      })

      const raw = Buffer.from("rollback-blob")
      const sha256 = createHash("sha256").update(raw).digest("hex")
      const invalidPart = { type: "message", role: "system", content: "bad" } as unknown as StoredMessagePart

      expect(() =>
        h.store.finishTurn(turn, {
          items: [invalidPart],
          blobs: [{ sha256, mime: "image/png", bytes: raw.byteLength, data: raw }],
          state: "completed",
        }),
      ).toThrow(MessagePartsError)

      expect(h.getTurnRow("s1", turn.assistantMessageId)?.state).toBe("running")
      expect(h.store.loadBlob(sha256)).toBeNull()
      expect(h.getArtifactRows("s1", turn.assistantMessageId)).toEqual([])

      const longError = "e".repeat(499) + "😀" + "e".repeat(150)
      h.store.finishTurn(turn, { state: "failed", errorMessage: longError })
      const row = h.getTurnRow("s1", turn.assistantMessageId)
      expect(row?.state).toBe("failed")
      expect(row?.error_message).toBe("e".repeat(499) + "😀")
    })

    it("rejects a missing blob reference without persisting any of the batch", () => {
      const h = createHarness()
      h.createSession("s1")
      const { turn } = h.store.beginTurn({ sessionId: "s1", clientRequestId: "req-1", prompt: "Read", workspacePath: "/repo" })
      const first = toStoredMedia(
        [{ type: "input_image", image_url: "data:image/png;base64,AA==" }],
        { path: "/repo/first.png" },
      )
      const missing = toStoredMedia(
        [{ type: "input_image", image_url: "data:image/png;base64,AQ==" }],
        { path: "/repo/missing.png" },
      )
      expect(() => h.store.finishTurn(turn, {
        items: [
          { type: "function_call_output", call_id: "c1", output: first.parts },
          { type: "function_call_output", call_id: "c2", output: missing.parts },
        ],
        blobs: first.blobs,
        state: "completed",
      })).toThrow("Missing media blob")
      expect(h.store.loadBlob(first.blobs[0]!.sha256)).toBeNull()
      expect(h.getArtifactRows("s1", turn.assistantMessageId)).toEqual([])
      expect(h.getTurnRow("s1", turn.assistantMessageId)?.state).toBe("running")
      h.store.finishTurn(turn, { state: "completed" })
      const { history } = h.store.beginTurn({ sessionId: "s1", clientRequestId: "req-2", prompt: "Next", workspacePath: "/repo" })
      expect(history[0]?.items).toEqual([{ type: "message", role: "user", content: "Read" }])
    })

    it("throws TurnGoneError when appending or finishing after session deletion", () => {
      const h = createHarness()
      h.createSession("s1")

      const { turn } = h.store.beginTurn({
        sessionId: "s1",
        clientRequestId: "req-1",
        prompt: "Delete me",
        workspacePath: "/repo",
      })
      h.deleteSession("s1")

      expect(() =>
        h.store.appendSteps(turn, [{ type: "message", role: "assistant", content: "late" }]),
      ).toThrow(TurnGoneError)

      expect(() =>
        h.store.finishTurn(turn, { state: "completed" }),
      ).toThrow(TurnGoneError)
    })

    it("deduplicates blobs, records artifacts for blob and path refs, and prunes orphan blobs", () => {
      const h = createHarness()
      h.createSession("s1")
      h.createSession("s2")

      const imageBytes = Buffer.from("shared-image-bytes")
      const storedImage = toStoredMedia(
        [
          { type: "input_text", text: "Read file: shot.png (PNG image)." },
          { type: "input_image", image_url: `data:image/png;base64,${imageBytes.toString("base64")}`, detail: "auto" },
        ],
        { path: "/repo/shot.png" },
      )
      const uniqueBytes = Buffer.from("s1-only-image-bytes")
      const storedUnique = toStoredMedia(
        [{ type: "input_image", image_url: `data:image/png;base64,${uniqueBytes.toString("base64")}`, detail: "auto" }],
        { path: "/repo/only.png" },
      )
      const pdfBytes = Buffer.from("%PDF-1.7 sample")
      const storedPdf = toStoredMedia(
        [{ type: "input_file", filename: "spec.pdf", file_data: `data:application/pdf;base64,${pdfBytes.toString("base64")}` }],
        { path: "/repo/spec.pdf" },
      )

      const t1 = h.store.beginTurn({
        sessionId: "s1",
        clientRequestId: "req-1",
        prompt: "Read files",
        workspacePath: "/repo",
      })
      h.store.appendSteps(
        t1.turn,
        [
          { type: "function_call_output", call_id: "c1", output: storedImage.parts } as StoredMessagePart,
          { type: "function_call_output", call_id: "c2", output: storedUnique.parts } as StoredMessagePart,
          { type: "function_call_output", call_id: "c3", output: storedPdf.parts } as StoredMessagePart,
        ],
        [...storedImage.blobs, ...storedUnique.blobs],
      )
      h.store.finishTurn(t1.turn, { state: "completed" })

      const sharedSha = storedImage.blobs[0]!.sha256
      const uniqueSha = storedUnique.blobs[0]!.sha256

      expect(h.getArtifactRows("s1", t1.turn.assistantMessageId)).toEqual([
        {
          direction: "out",
          path: `media:${sharedSha}`,
          name: "shot.png",
          mime_type: "image/png",
          size_bytes: imageBytes.byteLength,
          sha256: sharedSha,
        },
        {
          direction: "out",
          path: `media:${uniqueSha}`,
          name: "only.png",
          mime_type: "image/png",
          size_bytes: uniqueBytes.byteLength,
          sha256: uniqueSha,
        },
        {
          direction: "out",
          path: "/repo/spec.pdf",
          name: "spec.pdf",
          mime_type: "application/pdf",
          size_bytes: pdfBytes.byteLength,
          sha256: null,
        },
      ])

      const t2 = h.store.beginTurn({
        sessionId: "s2",
        clientRequestId: "req-1",
        prompt: "Reuse image",
        workspacePath: "/repo",
      })
      h.store.appendSteps(
        t2.turn,
        [{ type: "function_call_output", call_id: "c4", output: storedImage.parts } as StoredMessagePart],
      )
      h.store.appendSteps(
        t2.turn,
        [{ type: "function_call_output", call_id: "c5", output: storedImage.parts } as StoredMessagePart],
        storedImage.blobs,
      )
      h.store.finishTurn(t2.turn, { state: "completed" })

      expect(h.getArtifactRows("s2", t2.turn.assistantMessageId)).toHaveLength(2)
      expect(h.store.loadBlob(sharedSha)).toEqual(imageBytes)
      expect(h.store.loadBlob(uniqueSha)).toEqual(uniqueBytes)
      expect(h.store.pruneOrphanBlobs()).toBe(0)

      h.deleteSession("s1")
      expect(h.store.pruneOrphanBlobs()).toBe(1)
      expect(h.store.loadBlob(uniqueSha)).toBeNull()
      expect(h.store.loadBlob(sharedSha)).toEqual(imageBytes)

      h.deleteSession("s2")
      expect(h.store.pruneOrphanBlobs()).toBe(1)
      expect(h.store.loadBlob(sharedSha)).toBeNull()
    })
  })
}

runTurnStoreSuite("SqliteTurnStore", () => createSqliteHarness().harness)
runTurnStoreSuite("InMemoryTurnStore", createInMemoryHarness)

describe("SqliteTurnStore SQLite-specific guarantees", () => {
  it("rejects a stale handle even when SQLite reuses its message ID", () => {
    const { harness } = createSqliteHarness()
    harness.createSession("s1")
    const { turn: stale } = harness.store.beginTurn({ sessionId: "s1", clientRequestId: "old", prompt: "Old", workspacePath: "/repo" })
    harness.deleteSession("s1")
    harness.createSession("s1")
    const { turn: current } = harness.store.beginTurn({ sessionId: "s1", clientRequestId: "new", prompt: "New", workspacePath: "/repo" })
    expect(current.assistantMessageId).toBe(stale.assistantMessageId)
    expect(() => harness.store.appendSteps(stale, [])).toThrow(TurnGoneError)
    expect(() => harness.store.finishTurn(stale, { state: "completed" })).toThrow(TurnGoneError)
    expect(harness.getTurnRow("s1", current.assistantMessageId)?.state).toBe("running")
  })

  it("rolls back the entire finishTurn transaction when a later database error occurs", () => {
    const { harness, db } = createSqliteHarness()
    harness.createSession("s1")

    const { turn } = harness.store.beginTurn({
      sessionId: "s1",
      clientRequestId: "req-1",
      prompt: "Trigger rollback",
      workspacePath: "/repo",
    })

    // Trigger fails on artifact insert after messages UPDATE has already run in the same transaction
    db.exec(`
      CREATE TRIGGER fail_artifact_insert BEFORE INSERT ON artifacts
      BEGIN SELECT RAISE(ABORT, 'simulated disk error'); END;
    `)

    const imageBytes = Buffer.from("img")
    const stored = toStoredMedia(
      [{ type: "input_image", image_url: `data:image/png;base64,${imageBytes.toString("base64")}`, detail: "auto" }],
      { path: "/repo/img.png" },
    )

    expect(() =>
      harness.store.finishTurn(turn, {
        items: [{ type: "function_call_output", call_id: "c1", output: stored.parts } as StoredMessagePart],
        blobs: stored.blobs,
        state: "completed",
      }),
    ).toThrow("simulated disk error")

    const messageRow = db.prepare("SELECT state, parts_json FROM messages WHERE id = ?").get(turn.assistantMessageId) as {
      state: string
      parts_json: string
    }
    expect(messageRow.state).toBe("running")
    expect(messageRow.parts_json).toBe('{"v":1,"parts":[]}')
    expect(db.prepare("SELECT count(*) AS n FROM media_blob").get()).toEqual({ n: 0 })
    expect(db.prepare("SELECT count(*) AS n FROM artifacts").get()).toEqual({ n: 0 })
  })

  it("decodes paired text rows from a migrated v1 database", () => {
    const { harness, db } = createSqliteHarness(MIGRATIONS.slice(0, 1))
    harness.createSession("s1")
    db.prepare(`
      INSERT INTO messages (session_id, seq, role, parts_json, updated_at)
      VALUES ('s1', 1, 'user', '{"v":1,"parts":[{"type":"text","text":"legacy hi"}]}', 1),
             ('s1', 4, 'assistant', '{"v":1,"parts":[{"type":"text","text":"legacy reply"}]}', 4)`).run()
    migrate(db)

    const { turn, history } = harness.store.beginTurn({
      sessionId: "s1",
      clientRequestId: "req-v2",
      prompt: "new prompt",
      workspacePath: "/repo",
    })
    expect(turn.userSeq).toBe(5)
    expect(turn.assistantSeq).toBe(6)
    expect(history).toEqual([
      {
        userSeq: 1,
        assistantSeq: 4,
        state: "completed",
        items: [
          { type: "message", role: "user", content: "legacy hi" },
          { type: "message", role: "assistant", content: "legacy reply" },
        ],
      },
    ])
  })

  it("reports an unpaired legacy message without modifying history", () => {
    const { harness, db } = createSqliteHarness(MIGRATIONS.slice(0, 1))
    harness.createSession("s1")
    const parts = '{"v":1,"parts":[{"type":"text","text":"legacy prompt"}]}'
    db.prepare(`
      INSERT INTO messages (session_id, seq, role, parts_json, updated_at)
      VALUES ('s1', 1, 'user', ?, 1)`).run(parts)
    migrate(db)

    expect(() => harness.store.beginTurn({
      sessionId: "s1",
      clientRequestId: "req-v2",
      prompt: "new prompt",
      workspacePath: "/repo",
    })).toThrow("Unpaired user message at seq 1 in session s1")
    expect(db.prepare("SELECT seq, parts_json FROM messages").all()).toEqual([{ seq: 1, parts_json: parts }])
  })
})

describe("mediaArtifacts", () => {
  it("registers media only from tool output, never from model items", () => {
    const ref = { type: "ccodex_media_ref", kind: "file", name: "x.pdf", mime: "application/pdf", bytes: 5, turnRead: true, path: "/etc/x.pdf" } as const
    const items = [
      ref,
      { type: "message", role: "assistant", content: [ref] },
      { type: "function_call_output", call_id: "c1", output: [{ ...ref, path: "/repo/doc.pdf" }] },
    ] as unknown as StoredMessagePart[]
    expect(mediaArtifacts(items).map((artifact) => artifact.path)).toEqual(["/repo/doc.pdf"])
  })
})
