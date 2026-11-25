import { decodeParts, encodeParts, type StoredMessagePart } from "../../contracts/message-parts"
import { pruneOrphanBlobs, type Db } from "../../infrastructure/db/sqlite"
import type { MediaBlob } from "../context/media"
import type { HistoryTurn, TurnState } from "../context/types"
import {
  decodeMessageParts,
  finishErrorMessage,
  mediaArtifacts,
  TurnConflictError,
  TurnGoneError,
  validateBlobSize,
  type BeginTurnInput,
  type BeginTurnResult,
  type FinishTurnInput,
  type TurnHandle,
  type TurnStore,
} from "./turn-store"

const RUNNING_TURN = "id = ? AND session_id = ? AND client_request_id = ? AND state = 'running'"

interface MessageRow {
  seq: number
  role: "user" | "assistant"
  parts_json: string
  state: TurnState | null
}

interface ExistingTurnRow {
  id: number
  seq: number
  state: TurnState | null
  workspace_path: string | null
}

export class SqliteTurnStore implements TurnStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  recoverInterrupted(): number {
    const result = this.db.prepare(`
      UPDATE messages
      SET state = 'interrupted', updated_at = ?
      WHERE state = 'running'`).run(this.now())
    return result.changes
  }

  beginTurn(input: BeginTurnInput): BeginTurnResult {
    return this.db.transaction(() => {
      const existing = this.db.prepare(`
        SELECT id, seq, state, workspace_path
        FROM messages
        WHERE session_id = ? AND client_request_id = ?`).get(input.sessionId, input.clientRequestId) as ExistingTurnRow | undefined

      if (existing) {
        const userSeq = existing.seq - 1
        const userRow = this.db.prepare(`
          SELECT id
          FROM messages
          WHERE session_id = ? AND role = 'user' AND seq = ?`).get(input.sessionId, userSeq) as { id: number } | undefined
        if (!userRow || existing.state === null || existing.workspace_path === null) {
          throw new Error(`Incomplete turn ${existing.id} in session ${input.sessionId}`)
        }
        const priorRows = this.db.prepare(`
          SELECT seq, role, parts_json, state
          FROM messages
          WHERE session_id = ? AND seq < ?
          ORDER BY seq ASC`).all(input.sessionId, userSeq) as MessageRow[]
        return {
          created: false,
          turn: {
            sessionId: input.sessionId,
            userMessageId: userRow.id,
            assistantMessageId: existing.id,
            userSeq,
            assistantSeq: existing.seq,
            clientRequestId: input.clientRequestId,
            workspacePath: existing.workspace_path,
            state: existing.state,
          },
          history: rowsToHistoryTurns(input.sessionId, priorRows),
        }
      }

      const running = this.db.prepare(`
        SELECT 1 FROM messages WHERE session_id = ? AND state = 'running'`).get(input.sessionId)
      if (running) throw new TurnConflictError(input.sessionId)

      const existingRows = this.db.prepare(`
        SELECT seq, role, parts_json, state
        FROM messages
        WHERE session_id = ?
        ORDER BY seq ASC`).all(input.sessionId) as MessageRow[]

      const history = rowsToHistoryTurns(input.sessionId, existingRows)
      const maxSeq = existingRows.at(-1)?.seq ?? 0
      const userSeq = maxSeq + 1
      const assistantSeq = maxSeq + 2
      const timestamp = this.now()

      const userParts = encodeParts([{ type: "message", role: "user", content: input.prompt }])
      const assistantParts = encodeParts([])

      const insertMessage = this.db.prepare(`
        INSERT INTO messages (session_id, seq, role, parts_json, updated_at, state, client_request_id, workspace_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)

      const userInsert = insertMessage.run(
        input.sessionId,
        userSeq,
        "user",
        userParts,
        timestamp,
        null,
        null,
        input.workspacePath,
      )
      const assistantInsert = insertMessage.run(
        input.sessionId,
        assistantSeq,
        "assistant",
        assistantParts,
        timestamp,
        "running",
        input.clientRequestId,
        input.workspacePath,
      )

      return {
        created: true,
        turn: {
          sessionId: input.sessionId,
          userMessageId: Number(userInsert.lastInsertRowid),
          assistantMessageId: Number(assistantInsert.lastInsertRowid),
          userSeq,
          assistantSeq,
          clientRequestId: input.clientRequestId,
          workspacePath: input.workspacePath,
          state: "running" as const,
        },
        history,
      }
    }).immediate()
  }

  appendSteps(turn: TurnHandle, items: readonly StoredMessagePart[], blobs: readonly MediaBlob[] = []): void {
    this.writeSteps(turn, items, blobs)
  }

  finishTurn(turn: TurnHandle, input: FinishTurnInput): void {
    this.writeSteps(turn, input.items ?? [], input.blobs ?? [], { state: input.state, errorMessage: finishErrorMessage(input) })
  }

  private writeSteps(
    turn: TurnHandle,
    items: readonly StoredMessagePart[],
    blobs: readonly MediaBlob[],
    final?: { state: FinishTurnInput["state"]; errorMessage: string | null },
  ): void {
    this.db.transaction(() => {
      const timestamp = this.now()
      const identity = [turn.assistantMessageId, turn.sessionId, turn.clientRequestId]
      const current = this.db.prepare(`
        SELECT parts_json
        FROM messages
        WHERE ${RUNNING_TURN}`).get(...identity) as { parts_json: string } | undefined
      if (!current) throw new TurnGoneError(turn.sessionId, turn.assistantMessageId)

      const encoded = encodeParts([...decodeParts(current.parts_json), ...items])
      const updated = final
        ? this.db.prepare(`
            UPDATE messages SET parts_json = ?, updated_at = ?, state = ?, error_message = ?
            WHERE ${RUNNING_TURN}`).run(encoded, timestamp, final.state, final.errorMessage, ...identity)
        : this.db.prepare(`
            UPDATE messages SET parts_json = ?, updated_at = ?
            WHERE ${RUNNING_TURN}`).run(encoded, timestamp, ...identity)

      if (updated.changes !== 1) throw new TurnGoneError(turn.sessionId, turn.assistantMessageId)

      this.persistMedia(turn.assistantMessageId, items, blobs, timestamp)
    }).immediate()
  }

  pruneOrphanBlobs(): number {
    return pruneOrphanBlobs(this.db)
  }

  loadBlob(sha256: string): Buffer | null {
    const row = this.db.prepare("SELECT data FROM media_blob WHERE sha256 = ?").get(sha256) as { data: Uint8Array } | undefined
    if (!row) return null
    return Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data)
  }

  private persistMedia(
    assistantMessageId: number,
    items: readonly StoredMessagePart[],
    blobs: readonly MediaBlob[],
    timestamp: number,
  ): void {
    if (blobs.length > 0) {
      const insertBlob = this.db.prepare(`
        INSERT OR IGNORE INTO media_blob (sha256, mime, bytes, width, height, data, created_at)
        VALUES (?, ?, ?, NULL, NULL, ?, ?)`)
      for (const blob of blobs) {
        validateBlobSize(blob)
        insertBlob.run(blob.sha256, blob.mime, blob.bytes, blob.data, timestamp)
      }
    }

    const artifacts = mediaArtifacts(items)
    if (artifacts.length === 0) return
    const hasBlob = this.db.prepare("SELECT 1 FROM media_blob WHERE sha256 = ?")
    const insertArtifact = this.db.prepare(`
      INSERT INTO artifacts (message_id, direction, path, name, mime_type, size_bytes, created_at, sha256)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    for (const artifact of artifacts) {
      if (artifact.sha256 && !hasBlob.get(artifact.sha256)) {
        throw new Error(`Missing media blob: ${artifact.sha256}`)
      }
      insertArtifact.run(
        assistantMessageId,
        artifact.direction,
        artifact.path,
        artifact.name,
        artifact.mimeType,
        artifact.sizeBytes,
        timestamp,
        artifact.sha256,
      )
    }
  }
}

function rowsToHistoryTurns(sessionId: string, rows: readonly MessageRow[]): HistoryTurn[] {
  const turns: HistoryTurn[] = []
  for (let index = 0; index < rows.length; index += 2) {
    const user = rows[index]!
    const assistant = rows[index + 1]
    if (user.role !== "user" || assistant?.role !== "assistant") {
      throw new Error(`Unpaired ${user.role} message at seq ${user.seq} in session ${sessionId}`)
    }
    turns.push({
      userSeq: user.seq,
      assistantSeq: assistant.seq,
      state: assistant.state ?? "completed",
      items: [...decodeMessageParts(user.parts_json, "user"), ...decodeMessageParts(assistant.parts_json, "assistant")],
    })
  }
  return turns
}
