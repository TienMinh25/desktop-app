import { decodeParts, encodeParts, type StoredMessagePart } from "../../contracts/message-parts"
import type { MediaBlob } from "../context/media"
import type { HistoryTurn } from "../context/types"
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
  type TurnArtifact,
  type TurnHandle,
  type TurnStore,
} from "./turn-store"

interface StoredTurn {
  handle: TurnHandle
  userParts: string
  assistantParts: string
  errorMessage: string | null
  artifacts: TurnArtifact[]
}

export class InMemoryTurnStore implements TurnStore {
  constructor(private readonly projectId: number) {}

  private nextMessageId = 1
  private readonly turnsBySession = new Map<string, StoredTurn[]>()
  private readonly blobs = new Map<string, Buffer>()

  recoverInterrupted(): number {
    let recovered = 0
    for (const turns of this.turnsBySession.values()) {
      for (const turn of turns) {
        if (turn.handle.state === "running") {
          turn.handle = { ...turn.handle, state: "interrupted" }
          recovered += 1
        }
      }
    }
    return recovered
  }

  beginTurn(input: BeginTurnInput): BeginTurnResult {
    const turns = this.turnsBySession.get(input.sessionId) ?? []
    const existingIndex = turns.findIndex((turn) => turn.handle.clientRequestId === input.clientRequestId)
    if (existingIndex >= 0) {
      return {
        created: false,
        projectId: this.projectId,
        turn: { ...turns[existingIndex]!.handle },
        history: turns.slice(0, existingIndex).map(toHistoryTurn),
      }
    }
    if (turns.some((turn) => turn.handle.state === "running")) {
      throw new TurnConflictError(input.sessionId)
    }

    const history = turns.map(toHistoryTurn)
    const userParts = encodeParts([{ type: "message", role: "user", content: input.prompt }])
    const userSeq = (turns.at(-1)?.handle.assistantSeq ?? 0) + 1
    const handle: TurnHandle = {
      sessionId: input.sessionId,
      userMessageId: this.nextMessageId++,
      assistantMessageId: this.nextMessageId++,
      userSeq,
      assistantSeq: userSeq + 1,
      clientRequestId: input.clientRequestId,
      workspacePath: input.workspacePath,
      state: "running",
    }
    turns.push({ handle, userParts, assistantParts: encodeParts([]), errorMessage: null, artifacts: [] })
    this.turnsBySession.set(input.sessionId, turns)
    return { created: true, projectId: this.projectId, turn: { ...handle }, history }
  }

  appendSteps(turn: TurnHandle, items: readonly StoredMessagePart[], blobs: readonly MediaBlob[] = []): void {
    this.writeSteps(turn, items, blobs)
  }

  finishTurn(turn: TurnHandle, input: FinishTurnInput): void {
    const errorMessage = finishErrorMessage(input)
    const stored = this.writeSteps(turn, input.items ?? [], input.blobs ?? [])
    stored.handle = { ...stored.handle, state: input.state }
    stored.errorMessage = errorMessage
  }

  loadBlob(sha256: string): Buffer | null {
    const data = this.blobs.get(sha256)
    return data ? Buffer.from(data) : null
  }

  deleteSession(sessionId: string): void {
    this.turnsBySession.delete(sessionId)
  }

  getArtifacts(sessionId: string, assistantMessageId: number): TurnArtifact[] {
    return structuredClone(this.findTurn(sessionId, assistantMessageId)?.artifacts ?? [])
  }

  getTurnMetadata(sessionId: string, assistantMessageId: number) {
    const turn = this.findTurn(sessionId, assistantMessageId)
    if (!turn) return null
    return {
      state: turn.handle.state,
      errorMessage: turn.errorMessage,
      workspacePath: turn.handle.workspacePath,
    }
  }

  private findTurn(sessionId: string, assistantMessageId: number): StoredTurn | undefined {
    return this.turnsBySession.get(sessionId)?.find((turn) => turn.handle.assistantMessageId === assistantMessageId)
  }

  private writeSteps(turn: TurnHandle, items: readonly StoredMessagePart[], blobs: readonly MediaBlob[]): StoredTurn {
    const stored = this.findTurn(turn.sessionId, turn.assistantMessageId)
    if (stored?.handle.state !== "running" || stored.handle.clientRequestId !== turn.clientRequestId) {
      throw new TurnGoneError(turn.sessionId, turn.assistantMessageId)
    }
    const encoded = encodeParts([...decodeParts(stored.assistantParts), ...items])
    const artifacts = mediaArtifacts(items)
    const pending = new Map<string, Buffer>()
    for (const blob of blobs) {
      validateBlobSize(blob)
      if (!this.blobs.has(blob.sha256) && !pending.has(blob.sha256)) {
        pending.set(blob.sha256, Buffer.from(blob.data))
      }
    }
    for (const { sha256 } of artifacts) {
      if (sha256 && !this.blobs.has(sha256) && !pending.has(sha256)) {
        throw new Error(`Missing media blob: ${sha256}`)
      }
    }

    for (const [sha256, data] of pending) this.blobs.set(sha256, data)
    stored.assistantParts = encoded
    stored.artifacts = stored.artifacts.concat(artifacts)
    return stored
  }
}

function toHistoryTurn(turn: StoredTurn): HistoryTurn {
  const { userSeq, assistantSeq, state } = turn.handle
  return {
    userSeq,
    assistantSeq,
    state,
    items: [...decodeMessageParts(turn.userParts, "user"), ...decodeMessageParts(turn.assistantParts, "assistant")],
  }
}
