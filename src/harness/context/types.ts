import type { ResponseInputItem, ResponsesRequest } from "../../domain/chat/types"

export type TurnState = "running" | "completed" | "failed" | "interrupted"

export interface HistoryTurn {
  userSeq: number
  assistantSeq: number
  state: TurnState
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
