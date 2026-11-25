import { access } from "node:fs/promises"
import { isAbsolute } from "node:path"
import { decodeParts, isMediaRefPart, type StoredMessagePart } from "../../contracts/message-parts"
import type {
  OpenMediaPathResult,
  SessionHistoryMedia,
  SessionHistoryToolCall,
  SessionHistoryTurn,
  SessionHistoryTurnState,
} from "../../contracts/session-history"
import type { Db } from "../../infrastructure/db/sqlite"

export const MEDIA_PROTOCOL_SCHEME = "ccodex-media"

const SHA256_HEX = /^[a-f0-9]{64}$/i
const UNREADABLE_TURN_ERROR = "This turn could not be read."
const TOOL_ERROR_PREFIX = "Tool error:"

interface MessageRow {
  seq: number
  role: "user" | "assistant"
  parts_json: string
  updated_at: number
  state: SessionHistoryTurnState | null
  client_request_id: string | null
  error_message: string | null
  workspace_path: string | null
}

export function listSessionHistory(db: Db, sessionId: string): SessionHistoryTurn[] {
  const rows = db.prepare(`
    SELECT seq, role, parts_json, updated_at, state, client_request_id, error_message, workspace_path
    FROM messages
    WHERE session_id = ?
    ORDER BY seq ASC`).all(sessionId) as MessageRow[]

  const turns: SessionHistoryTurn[] = []
  let index = 0
  while (index < rows.length) {
    const current = rows[index]
    if (!current) break
    const next = rows[index + 1]
    if (current.role !== "user" || next?.role !== "assistant") {
      // Isolate an unpaired row so surrounding valid turns still load
      turns.push(current.role === "user" ? failedTurn(current, null) : failedTurn(null, current))
      index += 1
      continue
    }
    index += 2
    turns.push(buildTurn(current, next))
  }
  return turns
}

export function parseMediaSha256(value: string): string | null {
  return SHA256_HEX.test(value) ? value.toLowerCase() : null
}

export function parseMediaProtocolUrl(rawUrl: string): string | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== `${MEDIA_PROTOCOL_SCHEME}:`) return null
  if (url.username || url.password || url.port || url.search || url.hash) return null
  if (url.pathname !== "" && url.pathname !== "/") return null
  return parseMediaSha256(url.hostname)
}

export function readReferencedMediaBlob(db: Db, rawHash: string): { mime: string; data: Uint8Array } | null {
  const sha256 = parseMediaSha256(rawHash)
  if (!sha256) return null
  const row = db.prepare(`
    SELECT b.mime, b.data
    FROM media_blob AS b
    WHERE b.sha256 = ?
      AND EXISTS (SELECT 1 FROM artifacts AS a WHERE a.sha256 = b.sha256)`).get(sha256) as
    | { mime: string; data: Uint8Array }
    | null
    | undefined
  if (!row) return null
  return {
    mime: row.mime,
    data: Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data),
  }
}

export function isAllowedArtifactPath(db: Db, filePath: unknown): filePath is string {
  if (typeof filePath !== "string" || filePath.length === 0 || filePath.includes("\0") || !isAbsolute(filePath)) {
    return false
  }
  return Boolean(db.prepare("SELECT 1 FROM artifacts WHERE path = ?").get(filePath))
}

export async function openAllowedMediaPath(
  db: Db,
  filePath: unknown,
  openPath: (targetPath: string) => Promise<string>,
): Promise<OpenMediaPathResult> {
  if (!isAllowedArtifactPath(db, filePath)) return { ok: false, error: "not-allowed" }
  try {
    await access(filePath)
  } catch {
    return { ok: false, error: "missing" }
  }
  const error = await openPath(filePath)
  return error ? { ok: false, error: "missing" } : { ok: true }
}

function buildTurn(user: MessageRow, assistant: MessageRow): SessionHistoryTurn {
  let userParts: StoredMessagePart[]
  let assistantParts: StoredMessagePart[]
  try {
    userParts = decodeParts(user.parts_json)
    assistantParts = decodeParts(assistant.parts_json)
  } catch {
    return failedTurn(user, assistant)
  }

  const textChunks: string[] = []
  const toolCalls: SessionHistoryToolCall[] = []
  const toolCallsById = new Map<string, SessionHistoryToolCall>()

  for (const part of assistantParts) {
    if (part.type === "text" && typeof part.text === "string") {
      textChunks.push(part.text)
    } else if (part.type === "message" && part.role === "assistant") {
      extractContentText(part.content, "output_text", textChunks)
    } else if (part.type === "function_call" && typeof part.call_id === "string" && typeof part.name === "string") {
      const call: SessionHistoryToolCall = { callId: part.call_id, name: part.name, status: "pending" }
      toolCalls.push(call)
      toolCallsById.set(call.callId, call)
    } else if (part.type === "function_call_output" && typeof part.call_id === "string") {
      const call = toolCallsById.get(part.call_id)
      if (call) call.status = isToolErrorOutput(part.output) ? "error" : "done"
    }
  }

  const media: SessionHistoryMedia[] = []
  collectMedia(userParts, media)
  collectMedia(assistantParts, media)

  return {
    requestId: assistant.client_request_id,
    userSeq: user.seq,
    assistantSeq: assistant.seq,
    state: assistant.state,
    workspacePath: assistant.workspace_path ?? user.workspace_path,
    prompt: extractUserText(userParts),
    assistantText: textChunks.join(""),
    toolCalls,
    media,
    errorMessage: assistant.error_message,
    updatedAt: assistant.updated_at,
  }
}

function failedTurn(user: MessageRow | null, assistant: MessageRow | null): SessionHistoryTurn {
  const anchor = assistant ?? user
  if (!anchor) throw new Error("Expected at least one message row")
  return {
    requestId: assistant?.client_request_id ?? null,
    userSeq: user?.seq ?? anchor.seq,
    assistantSeq: assistant?.seq ?? anchor.seq,
    state: "failed",
    workspacePath: assistant?.workspace_path ?? user?.workspace_path ?? null,
    prompt: "",
    assistantText: "",
    toolCalls: [],
    media: [],
    errorMessage: UNREADABLE_TURN_ERROR,
    updatedAt: anchor.updated_at,
  }
}

function extractUserText(parts: readonly StoredMessagePart[]): string {
  const chunks: string[] = []
  for (const part of parts) {
    if (part.type === "text" && typeof part.text === "string") {
      chunks.push(part.text)
    } else if (part.type === "message" && part.role === "user") {
      extractContentText(part.content, "input_text", chunks)
    }
  }
  return chunks.join("")
}

function extractContentText(content: unknown, expectedType: "input_text" | "output_text", out: string[]): void {
  if (typeof content === "string") {
    out.push(content)
    return
  }
  if (!Array.isArray(content)) return
  for (const item of content as readonly unknown[]) {
    if (!item || typeof item !== "object") continue
    const record = item as Record<string, unknown>
    if (record.type === expectedType && typeof record.text === "string") {
      out.push(record.text)
    }
  }
}

function isToolErrorOutput(output: unknown): boolean {
  return typeof output === "string" && output.startsWith(TOOL_ERROR_PREFIX)
}

function collectMedia(parts: readonly StoredMessagePart[], out: SessionHistoryMedia[]): void {
  for (const part of parts) {
    let candidates: readonly unknown[] = [part]
    if (part.type === "function_call_output" && Array.isArray(part.output)) {
      candidates = part.output as readonly unknown[]
    } else if (part.type === "message" && Array.isArray(part.content)) {
      candidates = part.content as readonly unknown[]
    }
    for (const candidate of candidates) {
      if (!isMediaRefPart(candidate)) continue
      const item: SessionHistoryMedia = {
        kind: candidate.kind,
        name: candidate.name,
        mime: candidate.mime,
        bytes: candidate.bytes,
      }
      if (candidate.sha256 !== undefined) item.sha256 = candidate.sha256
      if (candidate.path !== undefined) item.path = candidate.path
      out.push(item)
    }
  }
}
