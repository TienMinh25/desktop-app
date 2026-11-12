export type ChatRole = "system" | "user" | "assistant" | "tool"

export interface ChatMessage {
  role: ChatRole
  content: string | null
  tool_call_id?: string
  tool_calls?: ChatToolCall[]
}

export interface ChatToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

export interface ChatToolDefinition {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ChatCompletionRequest {
  model: string
  messages: ChatMessage[]
  stream: true
  tools?: ChatToolDefinition[]
}

export type ChatStreamEvent =
  | { type: "text.delta"; text: string }
  | { type: "tool-call.delta"; index: number; id?: string; name?: string; argumentsDelta?: string }
  | { type: "stream.finished" }

export interface ChatModel {
  stream(request: ChatCompletionRequest, signal?: AbortSignal): AsyncIterable<ChatStreamEvent>
}

export interface ChatClientConfig {
  endpoint: string
  model: string
  accessToken: string
}
