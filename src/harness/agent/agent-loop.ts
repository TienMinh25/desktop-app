import type {
  ChatModel,
  FunctionCallOutputItem,
  ResponseFunctionCallItem,
  ResponseInputItem,
  ResponseOutputItem,
} from "../../domain/chat/types"
import type { BuildRequest, PersistBatch } from "../context/types"
import { ToolRegistry, type ToolContext } from "./tool-registry"

export const MAX_MODEL_ROUNDS = 25
export const MAX_TOOL_CALLS_PER_BATCH = 16

export interface AgentLoopInput {
  buildRequest: BuildRequest
  persistBatch: PersistBatch
  context: ToolContext
  signal?: AbortSignal
  onTextDelta(text: string): void
  onToolStarted?(toolCallId: string, toolName: string): void
  onToolCompleted?(toolCallId: string, toolName: string): void
  onToolFailed?(toolCallId: string, toolName: string, message: string): void
}

export interface AgentLoopResult {
  finalBatch: ResponseOutputItem[]
  assistantText: string
}

export class AgentLoop {
  constructor(private readonly tools: ToolRegistry) {}

  async run(model: ChatModel, input: AgentLoopInput): Promise<AgentLoopResult> {
    const steps: ResponseInputItem[] = []
    const seenCallIds = new Set<string>()
    let assistantText = ""

    for (let round = 1; round <= MAX_MODEL_ROUNDS; round += 1) {
      input.signal?.throwIfAborted()
      const final = round === MAX_MODEL_ROUNDS
      const request = input.buildRequest(steps, { final })
      const advertisedTools = new Set((request.tools ?? []).map((tool) => tool.name))

      let outputItems: ResponseOutputItem[] | undefined
      for await (const event of model.stream(request, input.signal)) {
        if (event.type === "text.delta") {
          assistantText += event.text
          input.onTextDelta(event.text)
        } else if (event.type === "response.output-items") {
          outputItems = event.items
        }
      }

      input.signal?.throwIfAborted()
      if (!outputItems) {
        throw new Error("Model stream ended without response.output-items")
      }

      rejectLocalOnlyItems(outputItems)
      const calls = extractFunctionCalls(outputItems)
      if (calls.length === 0) {
        return { finalBatch: outputItems, assistantText }
      }

      validateToolBatch(calls, advertisedTools, final, seenCallIds)

      await input.persistBatch(outputItems)
      steps.push(...outputItems)

      for (const call of calls) {
        input.signal?.throwIfAborted()
        input.onToolStarted?.(call.call_id, call.name)
        let output: FunctionCallOutputItem
        let toolError: string | undefined
        try {
          output = await this.tools.execute(call.name, call.arguments, input.context, call.call_id)
        } catch (error) {
          input.signal?.throwIfAborted()
          if (error instanceof Error && error.name === "AbortError") throw error
          toolError = error instanceof Error ? error.message : "Unknown tool error"
          output = { type: "function_call_output", call_id: call.call_id, output: `Tool error: ${toolError}` }
        }
        await input.persistBatch([output])
        steps.push(output)
        if (toolError === undefined) input.onToolCompleted?.(call.call_id, call.name)
        else input.onToolFailed?.(call.call_id, call.name, toolError)
      }
    }

    throw new Error(`Exceeded maximum model rounds (${MAX_MODEL_ROUNDS})`)
  }
}

function extractFunctionCalls(items: readonly ResponseOutputItem[]): ResponseFunctionCallItem[] {
  const calls: ResponseFunctionCallItem[] = []
  for (const item of items) {
    if (item.type !== "function_call") continue
    if (!isFunctionCall(item)) throw new Error("Model returned an invalid function_call item")
    calls.push(item)
  }
  return calls
}

// Tool outputs and media refs are written only by this process, so the model must never supply them
const LOCAL_ONLY_TYPES = new Set(["function_call_output", "ccodex_media_ref"])

function rejectLocalOnlyItems(items: readonly ResponseOutputItem[]): void {
  for (const item of items) {
    const content = "content" in item && Array.isArray(item.content) ? item.content : []
    if (LOCAL_ONLY_TYPES.has(item.type) || content.some((part) => LOCAL_ONLY_TYPES.has((part as { type?: unknown }).type as string))) {
      throw new Error(`Model returned a local-only item type: ${item.type}`)
    }
  }
}

function validateToolBatch(
  calls: readonly ResponseFunctionCallItem[],
  advertisedTools: ReadonlySet<string>,
  final: boolean,
  seenCallIds: Set<string>,
): void {
  if (final) {
    throw new Error("Model requested tool calls on the final round")
  }
  if (calls.length > MAX_TOOL_CALLS_PER_BATCH) {
    throw new Error(`Model requested ${calls.length} tool calls in one batch (limit ${MAX_TOOL_CALLS_PER_BATCH})`)
  }
  for (const call of calls) {
    if (seenCallIds.has(call.call_id)) {
      throw new Error(`Model returned duplicate tool call_id: ${call.call_id}`)
    }
    seenCallIds.add(call.call_id)
    if (!advertisedTools.has(call.name)) {
      throw new Error(`Model requested unadvertised tool: ${call.name}`)
    }
  }
}

function isFunctionCall(item: ResponseOutputItem): item is ResponseFunctionCallItem {
  return item.type === "function_call"
    && typeof item.call_id === "string"
    && item.call_id.length > 0
    && typeof item.name === "string"
    && item.name.length > 0
    && typeof item.arguments === "string"
    && typeof item.id === "string"
    && item.id.length > 0
}
