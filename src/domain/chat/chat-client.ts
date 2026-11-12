import type {
  ChatCompletionRequest,
  ChatModel,
  ChatStreamEvent,
  ChatClientConfig,
} from "./types"
import { StreamingHttpClient, type UndiciFetch } from "../../infrastructure/http/http-client"
import type { Response as HttpResponse } from "undici-types"

const RESPONSE_HEADERS_TIMEOUT_MS = 300_000
const STREAM_IDLE_TIMEOUT_MS = 900_000

interface ChatStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
}

export class ChatClient implements ChatModel {
  private readonly http: StreamingHttpClient

  constructor(
    private readonly config: ChatClientConfig,
    fetchImpl?: UndiciFetch,
  ) {
    this.http = new StreamingHttpClient(fetchImpl, {
      responseHeadersTimeoutMs: RESPONSE_HEADERS_TIMEOUT_MS,
      streamIdleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
    })
  }

  async *stream(
    request: ChatCompletionRequest,
    signal?: AbortSignal,
  ): AsyncIterable<ChatStreamEvent> {
    const controller = new AbortController()
    const forwardAbort = () => controller.abort(signal?.reason)
    if (signal?.aborted) forwardAbort()
    else signal?.addEventListener("abort", forwardAbort, { once: true })

    try {
      const response = await this.http.post(
        this.config.endpoint,
        { ...request, model: this.config.model, stream: true },
        { Authorization: `Bearer ${this.config.accessToken}` },
        controller.signal,
      )

      if (!response.ok) {
        const body = await readResponsePreview(response, 8000)
        throw new Error(`Chat endpoint returned ${response.status}: ${body}`)
      }
      if (!response.body) throw new Error("Chat endpoint returned an empty response body")

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let pending = ""
      let finished = false

      try {
        while (!finished) {
          const { value, done } = await reader.read()
          pending += decoder.decode(value, { stream: !done })
          if (pending.length > 1_000_000) throw new Error("Chat SSE frame exceeded 1 MB")
          const lines = pending.split(/\r?\n/)
          pending = lines.pop() ?? ""
          if (done && pending) { lines.push(pending); pending = "" }

          for (const line of lines) {
            if (!line.startsWith("data:")) continue
            const data = line.slice(5).trim()
            if (!data) continue
            if (data === "[DONE]") {
              finished = true
              break
            }

            const chunk = parseChatStreamChunk(data)
            const delta = chunk.choices?.[0]?.delta
            if (delta?.content) yield { type: "text.delta", text: delta.content }
            for (const toolCall of delta?.tool_calls ?? []) {
              yield {
                type: "tool-call.delta",
                index: toolCall.index,
                id: toolCall.id,
                name: toolCall.function?.name,
                argumentsDelta: toolCall.function?.arguments,
              }
            }
          }

          if (done) finished = true
        }
      } finally {
        await reader.cancel().catch(() => {})
      }
      yield { type: "stream.finished" }
    } finally {
      signal?.removeEventListener("abort", forwardAbort)
    }
  }
}

function parseChatStreamChunk(data: string): ChatStreamChunk {
  let value: unknown
  try { value = JSON.parse(data) }
  catch (error) { throw new Error(`Invalid Chat Completions stream chunk: ${error instanceof Error ? error.message : String(error)}`) }
  if (!isChatStreamChunk(value)) throw new Error("Invalid Chat Completions stream chunk shape")
  return value
}

function isChatStreamChunk(value: unknown): value is ChatStreamChunk {
  if (!isRecord(value)) return false
  if (value.choices === undefined) return true
  if (!Array.isArray(value.choices)) return false
  return value.choices.every((choice) => {
    if (!isRecord(choice)) return false
    if (choice.finish_reason !== undefined && choice.finish_reason !== null && typeof choice.finish_reason !== "string") return false
    if (choice.delta === undefined) return true
    if (!isRecord(choice.delta)) return false
    const delta = choice.delta
    if (delta.content !== undefined && delta.content !== null && typeof delta.content !== "string") return false
    if (delta.tool_calls === undefined) return true
    if (!Array.isArray(delta.tool_calls)) return false
    return delta.tool_calls.every((toolCall) => {
      if (!isRecord(toolCall) || !Number.isInteger(toolCall.index)) return false
      if (toolCall.id !== undefined && typeof toolCall.id !== "string") return false
      if (toolCall.function === undefined) return true
      if (!isRecord(toolCall.function)) return false
      return (toolCall.function.name === undefined || typeof toolCall.function.name === "string")
        && (toolCall.function.arguments === undefined || typeof toolCall.function.arguments === "string")
    })
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function readResponsePreview(response: HttpResponse, limit: number): Promise<string> {
  if (!response.body) return "(empty response body)"
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let output = ""
  try {
    while (output.length < limit) {
      const { value, done } = await reader.read()
      if (done) break
      output += decoder.decode(value, { stream: true })
    }
    output += decoder.decode()
    return output.slice(0, limit)
  } finally {
    await reader.cancel().catch(() => {})
  }
}

