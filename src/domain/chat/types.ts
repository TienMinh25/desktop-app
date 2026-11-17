export type ChatRole = "system" | "developer" | "user" | "assistant"

export interface InputTextContent {
  type: "input_text"
  text: string
}

export interface InputImageContent {
  type: "input_image"
  image_url: string
  detail?: "low" | "high" | "auto"
}

export interface InputFileContent {
  type: "input_file"
  filename: string
  file_data: string
  detail?: "low" | "high" | "auto"
}

export type ResponseInputContent = InputTextContent | InputImageContent | InputFileContent

export interface EasyInputMessage {
  type?: "message"
  role: ChatRole
  content: string | ResponseInputContent[]
}

export interface FunctionCallOutputItem {
  type: "function_call_output"
  call_id: string
  output: string | ResponseInputContent[]
}

/** Completed Responses output items are replayed verbatim in later requests. */
export interface ResponseOutputItem {
  type: string
  [key: string]: unknown
}

export interface ResponseFunctionCallItem extends ResponseOutputItem {
  type: "function_call"
  id: string
  call_id: string
  name: string
  arguments: string
}

export type ResponseInputItem = EasyInputMessage | FunctionCallOutputItem | ResponseOutputItem

export interface ChatToolDefinition {
  type: "function"
  name: string
  description: string
  parameters: Record<string, unknown>
  strict?: boolean
}

export interface ResponsesRequest {
  model: string
  input: ResponseInputItem[]
  stream: true
  tools?: ChatToolDefinition[]
}

export type ChatStreamEvent =
  | { type: "text.delta"; text: string }
  | { type: "response.output-items"; items: ResponseOutputItem[] }
  | { type: "stream.finished" }

export interface ChatModel {
  stream(request: ResponsesRequest, signal?: AbortSignal): AsyncIterable<ChatStreamEvent>
  close?(): Promise<void>
}

export interface ChatClientConfig {
  model: string
}
