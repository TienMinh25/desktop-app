import type { ResponseInputItem, ResponsesRequest } from "../../domain/chat/types"
import { boundMedia } from "./media"
import type { TurnSnapshot } from "./turn-snapshot"
import type { AssembleOptions } from "./types"

export {
  loadTurnSnapshot,
  type LoadTurnSnapshotInput,
  type LoadTurnSnapshotResult,
  type TurnSnapshot,
} from "./turn-snapshot"

export function assembleRequest(
  snapshot: TurnSnapshot,
  steps: readonly ResponseInputItem[],
  options?: AssembleOptions,
): ResponsesRequest {
  const instructionItems: ResponseInputItem[] = snapshot.instructions.map((section) => ({
    type: "message",
    role: "developer",
    content: section.text,
  }))
  const historyItems: ResponseInputItem[] = snapshot.history.flatMap((turn) => turn.items)
  const currentPrompt: ResponseInputItem = {
    type: "message",
    role: "user",
    content: snapshot.prompt,
  }

  const tools = options?.final || snapshot.tools.length === 0 ? undefined : [...snapshot.tools]
  const request: ResponsesRequest = {
    model: snapshot.model,
    input: [...instructionItems, ...historyItems, currentPrompt, ...steps],
    stream: true,
    ...(tools ? { tools } : {}),
  }

  return {
    ...request,
    input: boundMedia(request),
  }
}
