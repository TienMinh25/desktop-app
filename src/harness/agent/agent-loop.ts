import type { ChatMessage, ChatModel, ChatToolCall } from "../../domain/chat/types"
import { ToolRegistry, type ToolContext } from "./tool-registry"

export interface AgentLoopInput {
  modelName: string
  messages: ChatMessage[]
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

  async run(input: AgentLoopInput): Promise<{ messages: ChatMessage[]; assistantText: string }> {
    const messages = [...input.messages]
    let assistantText = ""

    while (true) {
      const calls = new Map<number, ChatToolCall>()
      let roundText = ""
      for await (const chunk of this.model.stream({
        model: input.modelName,
        messages,
        stream: true,
        ...(this.tools.definitions().length ? { tools: this.tools.definitions() } : {}),
      }, input.signal)) {
        if (chunk.type === "text.delta") {
          roundText += chunk.text
          assistantText += chunk.text
          input.onTextDelta(chunk.text)
        } else if (chunk.type === "tool-call.delta") {
          const previous = calls.get(chunk.index) ?? {
            id: "",
            type: "function" as const,
            function: { name: "", arguments: "" },
          }
          if (chunk.id) previous.id = chunk.id
          if (chunk.name) previous.function.name += chunk.name
          previous.function.arguments += chunk.argumentsDelta ?? ""
          if (previous.function.arguments.length > 1_000_000) throw new Error("Model tool-call arguments exceed 1 MB")
          calls.set(chunk.index, previous)
        }
      }

      const toolCalls = [...calls.values()]
      messages.push({ role: "assistant", content: roundText || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) })
      if (!toolCalls.length) return { messages, assistantText }

      for (const call of toolCalls) {
        input.onToolStarted?.(call.id, call.function.name)
        try {
          const result = await this.tools.execute(call.function.name, call.function.arguments, input.context)
          messages.push({ ...result, tool_call_id: call.id })
          input.onToolCompleted?.(call.id, call.function.name)
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown tool error"
          input.onToolFailed?.(call.id, call.function.name, message)
          messages.push({ role: "tool", tool_call_id: call.id, content: `Tool error: ${message}` })
        }
      }
    }
  }
}
