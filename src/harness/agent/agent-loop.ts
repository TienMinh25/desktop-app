import type { ResponseFunctionCallItem, ResponseInputItem, ResponseOutputItem, ChatModel } from "../../domain/chat/types"
import { ToolRegistry, type ToolContext } from "./tool-registry"

export interface AgentLoopInput {
  modelName: string
  messages: ResponseInputItem[]
  context: ToolContext
  signal?: AbortSignal
  onTextDelta(text: string): void
  onToolStarted?(toolCallId: string, toolName: string): void
  onToolCompleted?(toolCallId: string, toolName: string): void
  onToolFailed?(toolCallId: string, toolName: string, message: string): void
}

export class AgentLoop {
  constructor(
    private readonly model: ChatModel,
    private readonly tools: ToolRegistry,
  ) {}

  async run(input: AgentLoopInput): Promise<{ messages: ResponseInputItem[]; assistantText: string }> {
    const messages = [...input.messages]
    let assistantText = ""

    while (true) {
      let outputItems: ResponseOutputItem[] = []
      for await (const event of this.model.stream({
        model: input.modelName,
        input: messages,
        stream: true,
        ...(this.tools.definitions().length ? { tools: this.tools.definitions() } : {}),
      }, input.signal)) {
        if (event.type === "text.delta") {
          assistantText += event.text
          input.onTextDelta(event.text)
        } else if (event.type === "response.output-items") {
          outputItems = event.items
        }
      }

      messages.push(...outputItems)
      const calls = outputItems.filter(isFunctionCall)
      if (!calls.length) return { messages, assistantText }

      for (const call of calls) {
        input.onToolStarted?.(call.call_id, call.name)
        try {
          const result = await this.tools.execute(call.name, call.arguments, input.context, call.call_id)
          messages.push(result)
          input.onToolCompleted?.(call.call_id, call.name)
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown tool error"
          input.onToolFailed?.(call.call_id, call.name, message)
          messages.push({ type: "function_call_output", call_id: call.call_id, output: `Tool error: ${message}` })
        }
      }
    }
  }
}

function isFunctionCall(item: ResponseOutputItem): item is ResponseFunctionCallItem {
  return item.type === "function_call"
    && typeof item.call_id === "string"
    && typeof item.name === "string"
    && typeof item.arguments === "string"
    && typeof item.id === "string"
}
