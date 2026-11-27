import type { ResponseInputItem, ResponsesRequest } from "../../domain/chat/types"

// The persisted turn state is declared once in contracts
import type { SessionHistoryTurnState as TurnRowState } from "../../contracts/session-history"
export type { TurnRowState }

export interface HistoryTurn {
  userSeq: number
  assistantSeq: number
  state: TurnRowState
  items: ResponseInputItem[]
}

export interface InstructionSection {
  kind: "base" | "environment" | "agents_md"
  source?: string
  text: string
}

export interface AssembleOptions {
  final?: boolean
}

export type BuildRequest = (steps: readonly ResponseInputItem[], options?: AssembleOptions) => ResponsesRequest

export type PersistBatch = (items: readonly ResponseInputItem[]) => Promise<void>
