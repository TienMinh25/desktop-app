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
  // Claude has no developer role, so all instructions go in one system message the backend maps to its system field
  const instructionItem: ResponseInputItem = {
    type: "message",
    role: "system",
    // Label workspace rules so they stay distinct from the app's own instructions in the merged text
    content: snapshot.instructions
      .map((section) => section.kind === "agents_md" ? `AGENTS.md from the workspace:\n${section.text}` : section.text)
      .join("\n\n"),
  }
  const historyItems: ResponseInputItem[] = snapshot.history.flatMap((turn) => turn.items)
  const currentPrompt: ResponseInputItem = {
    type: "message",
    role: "user",
    content: snapshot.prompt,
  }

  const tools = options?.final || snapshot.tools.length === 0 ? undefined : [...snapshot.tools]
  const request: ResponsesRequest = {
    project_id: snapshot.projectId,
    model: snapshot.model,
    input: [instructionItem, ...historyItems, currentPrompt, ...steps],
    ...(tools ? { tools } : {}),
  }

  return {
    ...request,
    input: boundMedia(request),
  }
}
