import type { StoredContentPart } from "../../contracts/message-parts"
import type { ChatToolDefinition, ResponseInputItem } from "../../domain/chat/types"
import { loadAgentsMd, type AgentsMdEnvironment } from "./agents-md"
import { BASE_PROMPT } from "./base-prompt"
import { hydrateMedia, type HydrateMediaOptions } from "./media"
import type { HistoryTurn, InstructionSection } from "./types"

export interface TurnSnapshot {
  readonly model: string
  readonly prompt: string
  readonly tools: readonly ChatToolDefinition[]
  readonly instructions: readonly InstructionSection[]
  readonly history: readonly HistoryTurn[]
}

export interface LoadTurnSnapshotInput {
  model: string
  prompt: string
  history: readonly HistoryTurn[]
  tools?: readonly ChatToolDefinition[]
  workspacePath: string
  environment: AgentsMdEnvironment
  loadBlob: HydrateMediaOptions["loadBlob"]
  readFileBase64: HydrateMediaOptions["readFileBase64"]
  now?: Date
  platform?: string
}

export interface LoadTurnSnapshotResult {
  readonly snapshot: TurnSnapshot
  readonly warnings: readonly string[]
}

export async function loadTurnSnapshot(input: LoadTurnSnapshotInput): Promise<LoadTurnSnapshotResult> {
  const now = input.now ?? new Date()
  const platform = input.platform ?? process.platform
  const agents = await loadAgentsMd(input.environment)

  const instructions: InstructionSection[] = [
    { kind: "base", text: BASE_PROMPT },
    buildEnvironmentSection(input.workspacePath, platform, now),
    ...(agents.section ? [agents.section] : []),
  ]
  const warnings = agents.warning ? [agents.warning] : []

  const history = structuredClone(input.history)
  const contentGroups: StoredContentPart[][] = []
  let skippedStandaloneMedia = false
  for (const turn of history) {
    // A failed write or crash can leave durable calls without a Responses tool output.
    const completedCalls = turn.state === "interrupted" || turn.state === "failed"
      ? new Set(turn.items.flatMap((item) => item.type === "function_call_output" ? [item.call_id] : []))
      : undefined
    const items: ResponseInputItem[] = []
    for (const item of turn.items) {
      if (item.type === "function_call" && completedCalls && !completedCalls.has(item.call_id)) continue
      if (item.type === "ccodex_media_ref") {
        skippedStandaloneMedia = true
        continue
      }
      const content = getItemContent(item)
      if (content) contentGroups.push(content)
      items.push(item)
    }
    turn.items = items
  }
  if (skippedStandaloneMedia) warnings.push("Skipped standalone media references in conversation history.")

  // Hydrate together so repeated references share one read and base64 encoding
  const hydrated = await hydrateMedia(contentGroups.flat(), {
    currentTurn: false,
    loadBlob: input.loadBlob,
    readFileBase64: input.readFileBase64,
  })
  let offset = 0
  for (const group of contentGroups) {
    for (let index = 0; index < group.length; index += 1) {
      const part = hydrated[offset++]!
      group[index] = part.type === "input_file"
        ? { type: "input_text", text: `File ${part.filename} was read in an earlier turn. Call read again if you need its content.` }
        : part
    }
  }

  const snapshot: TurnSnapshot = deepFreeze({
    model: input.model,
    prompt: input.prompt,
    tools: structuredClone(input.tools ?? []),
    instructions,
    history,
  })

  return {
    snapshot,
    warnings: Object.freeze(warnings),
  }
}

function buildEnvironmentSection(workspacePath: string, platform: string, now: Date): InstructionSection {
  return {
    kind: "environment",
    text: [
      "Environment:",
      `- Workspace: ${workspacePath}`,
      `- OS: ${platform}`,
      `- Date: ${now.toISOString().slice(0, 10)}`,
    ].join("\n"),
  }
}

function getItemContent(item: ResponseInputItem): StoredContentPart[] | undefined {
  if (item.type === "function_call_output" && "output" in item && Array.isArray(item.output)) {
    return item.output
  }
  if ((item.type === undefined || item.type === "message") && "content" in item && Array.isArray(item.content)) {
    return item.content
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value
  Object.freeze(value)
  for (const nested of Object.values(value as Record<string, unknown>)) {
    if (nested !== null && typeof nested === "object" && !Object.isFrozen(nested)) {
      deepFreeze(nested)
    }
  }
  return value
}
