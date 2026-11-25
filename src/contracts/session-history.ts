export type SessionHistoryTurnState = "running" | "completed" | "failed" | "interrupted"

export interface SessionHistoryToolCall {
  callId: string
  name: string
  status: "done" | "error" | "pending"
}

export interface SessionHistoryMedia {
  kind: "image" | "file"
  name: string
  mime: string
  bytes: number
  sha256?: string
  path?: string
}

export interface SessionHistoryTurn {
  requestId: string | null
  userSeq: number
  assistantSeq: number
  state: SessionHistoryTurnState | null
  workspacePath: string | null
  prompt: string
  assistantText: string
  toolCalls: SessionHistoryToolCall[]
  media: SessionHistoryMedia[]
  errorMessage: string | null
  updatedAt: number
}

export type OpenMediaPathResult =
  | { ok: true }
  | { ok: false; error: "missing" | "not-allowed" }
