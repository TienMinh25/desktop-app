import { decodeParts, isMediaRefPart, type StoredMessagePart } from "../../contracts/message-parts"
import type {
  SessionHistoryMedia,
  SessionHistoryToolCall,
  SessionHistoryTurn,
  SessionHistoryTurnState,
} from "../../contracts/session-history"
import type { Db } from "../../infrastructure/db/sqlite"

const UNREADABLE_TURN_ERROR = "This turn could not be read."
const TOOL_ERROR_PREFIX = "Tool error: "

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
  for (let index = 0; index < rows.length; index += 1) {
    const current = rows[index]!
    const next = rows[index + 1]
    // Same pairing as the harness replay (sqlite-turn-store rowsToHistoryTurns): a user row and the next assistant row
    if (current.role === "user" && next?.role === "assistant") {
      turns.push(buildTurn(sessionId, current, next))
      index += 1
    } else {
      turns.push(buildTurn(sessionId, current, null))
    }
  }
  return turns
}

function buildTurn(sessionId: string, first: MessageRow, next: MessageRow | null): SessionHistoryTurn {
  const user = first.role === "user" ? first : null
  const assistant = first.role === "assistant" ? first : next
  const identity = {
    sessionId,
    requestId: assistant?.client_request_id ?? null,
    userSeq: user?.seq ?? null,
    assistantSeq: assistant?.seq ?? null,
    workspacePath: assistant?.workspace_path ?? user?.workspace_path ?? null,
    updatedAt: (assistant ?? first).updated_at,
  }

  // Decode each row alone so the readable side of a turn still shows
  const decodedUser = user ? tryDecode(user.parts_json) : []
  const decodedAssistant = assistant ? tryDecode(assistant.parts_json) : []
  const unreadable = !decodedUser || !decodedAssistant
  const userParts = decodedUser ?? []
  const assistantParts = decodedAssistant ?? []

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
    ...identity,
    state: unreadable ? "failed" : assistant?.state ?? null,
    prompt: extractUserText(userParts),
    assistantText: textChunks.join(""),
    toolCalls,
    media,
    errorMessage: unreadable ? UNREADABLE_TURN_ERROR : assistant?.error_message ?? null,
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
    } else if (expectedType === "output_text" && record.type === "refusal" && typeof record.refusal === "string") {
      out.push(record.refusal)
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

function tryDecode(partsJson: string): StoredMessagePart[] | null {
  try {
    return decodeParts(partsJson)
  } catch {
    return null
  }
}
