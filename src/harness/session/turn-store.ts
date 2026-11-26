import { decodeParts, isMediaRefPart, type StoredMessagePart } from "../../contracts/message-parts"
import type { ResponseInputItem } from "../../domain/chat/types"
import type { MediaBlob } from "../context/media"
import type { HistoryTurn, TurnState } from "../context/types"

const MAX_ERROR_MESSAGE_CHARS = 500

export interface TurnHandle {
  readonly sessionId: string
  readonly userMessageId: number
  readonly assistantMessageId: number
  readonly userSeq: number
  readonly assistantSeq: number
  readonly clientRequestId: string
  readonly workspacePath: string
  readonly state: TurnState
}

export interface BeginTurnInput {
  sessionId: string
  clientRequestId: string
  prompt: string
  workspacePath: string
}

export interface BeginTurnResult {
  created: boolean
  turn: TurnHandle
  history: HistoryTurn[]
}

export interface FinishTurnInput {
  items?: readonly StoredMessagePart[]
  blobs?: readonly MediaBlob[]
  state: "completed" | "failed"
  errorMessage?: string
}

export class TurnConflictError extends Error {
  constructor(readonly sessionId: string) {
    super(`Session ${sessionId} already has a running turn`)
    this.name = "TurnConflictError"
  }
}

export class TurnGoneError extends Error {
  constructor(readonly sessionId: string, readonly assistantMessageId: number) {
    super(`Turn ${assistantMessageId} in session ${sessionId} is no longer running`)
    this.name = "TurnGoneError"
  }
}

export interface TurnStore {
  recoverInterrupted(): number
  beginTurn(input: BeginTurnInput): BeginTurnResult
  appendSteps(turn: TurnHandle, items: readonly StoredMessagePart[], blobs?: readonly MediaBlob[]): void
  finishTurn(turn: TurnHandle, input: FinishTurnInput): void
  pruneOrphanBlobs(): number
  loadBlob(sha256: string): Buffer | null
}

export interface TurnArtifact {
  direction: "out"
  path: string
  name: string
  mimeType: string
  sizeBytes: number
  sha256: string | null
}

export function decodeMessageParts(partsJson: string, role: "user" | "assistant"): ResponseInputItem[] {
  return decodeParts(partsJson).map((part) => {
    // Legacy v1 rows stored plain text parts instead of Responses message items
    if (part.type === "text" && typeof part.text === "string") {
      return { type: "message", role, content: part.text }
    }
    return part
  })
}

export function mediaArtifacts(items: readonly StoredMessagePart[]): TurnArtifact[] {
  return items.flatMap((item) => {
    // Only read output registers media, so a model item cannot register a path that media:open-path would open
    if (item.type !== "function_call_output" || !("output" in item) || !Array.isArray(item.output)) return []
    return item.output.filter(isMediaRefPart).map<TurnArtifact>((ref) => ({
      direction: "out",
      path: ref.sha256 ? `media:${ref.sha256}` : ref.path!,
      name: ref.name,
      mimeType: ref.mime,
      sizeBytes: ref.bytes,
      sha256: ref.sha256 ?? null,
    }))
  })
}

export function validateBlobSize(blob: MediaBlob): void {
  if (blob.bytes !== blob.data.byteLength) throw new Error(`Invalid media blob size: ${blob.sha256}`)
}

export function finishErrorMessage(input: FinishTurnInput): string | null {
  if (input.state !== "completed" && input.state !== "failed") {
    throw new Error(`Invalid final turn state: ${String(input.state)}`)
  }
  const message = input.errorMessage
  if (message === undefined) return null
  if (message.length <= MAX_ERROR_MESSAGE_CHARS) return message
  // Slice code points to avoid splitting surrogate pairs
  return Array.from(message).slice(0, MAX_ERROR_MESSAGE_CHARS).join("")
}
