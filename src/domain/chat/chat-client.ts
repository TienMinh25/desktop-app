import type {
  ChatModel,
  ChatStreamEvent,
  ChatClientConfig,
  ResponseInputItem,
  ResponseOutputItem,
  ResponsesRequest,
  EasyInputMessage,
  FunctionCallOutputItem,
} from "./types"
import type { BackendHttpClient } from "../../infrastructure/http/backend-http-client"
import type { Response as HttpResponse } from "undici-types"
import { logger } from "../../infrastructure/logging/logger"
import { RESPONSES_LIMITS } from "./responses-limits"

const CHAT_STREAM_PATH = "api/v1/chat/responses"

interface ResponsesStreamEvent {
  type: string
  delta?: string
  response?: {
    output?: unknown
    error?: { message?: string }
    incomplete_details?: { reason?: string }
  }
  error?: { message?: string }
}

export class ChatClient implements ChatModel {
  constructor(
    private readonly config: ChatClientConfig,
    private readonly http: BackendHttpClient,
  ) {}

  async *stream(
    request: ResponsesRequest,
    signal?: AbortSignal,
  ): AsyncIterable<ChatStreamEvent> {
    const controller = new AbortController()
    const forwardAbort = () => controller.abort(signal?.reason)
    if (signal?.aborted) forwardAbort()
    else signal?.addEventListener("abort", forwardAbort, { once: true })

    try {
      const body = { ...request, model: this.config.model }
      enforceRequestMediaLimits(body.input)
      const serializedBody = JSON.stringify(body)
      const serializedBytes = Buffer.byteLength(serializedBody, "utf8")
      if (serializedBytes >= RESPONSES_LIMITS.serializedRequestBytes) {
        throw new Error("Responses request exceeds the 400 MB serialized payload limit")
      }

      const startedAt = Date.now()
      const response = await this.http.postSerialized(
        CHAT_STREAM_PATH,
        serializedBody,
        {},
        controller.signal,
      )

      if (!response.ok) {
        const bodyPreview = await readResponsePreview(response, 8000).catch(() => "(response body unavailable)")
        logger.apiError("POST", CHAT_STREAM_PATH, `Responses endpoint returned ${response.status}: ${bodyPreview}`, Date.now() - startedAt)
        throw new Error(`Responses endpoint returned ${response.status}`)
      }
      if (!response.body) throw new Error("Responses endpoint returned an empty response body")

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let pending = ""
      let frameData: string[] = []
      let completed = false

      try {
        while (!completed) {
          const { value, done } = await reader.read()
          pending += decoder.decode(value, { stream: !done })
          const extracted = extractSseLines(pending, done)
          pending = extracted.remainder
          const completedFrames: string[] = []

          for (const { line } of extracted.lines) {
            if (line === "") {
              if (frameData.length) completedFrames.push(frameData.join("\n"))
              frameData = []
              continue
            }

            if (!line.startsWith("data:")) continue
            frameData.push(line.slice(5).replace(/^ /, ""))
          }

          if (done && frameData.length) {
            completedFrames.push(frameData.join("\n"))
            frameData = []
          }

          for (const frameDataText of completedFrames) {
            const data = frameDataText.trim()
            if (!data) continue
            if (data === "[DONE]") {
              throw new Error("Responses stream ended before response.completed")
            }

            const event = parseResponsesEvent(data)
            if (event.type === "response.output_text.delta") {
              if (typeof event.delta !== "string") throw new Error("Responses text delta is missing its text")
              yield { type: "text.delta", text: event.delta }
            } else if (event.type === "response.completed") {
              const output = event.response?.output
              if (!Array.isArray(output) || !output.every(isResponseOutputItem)) {
                throw new Error("Responses completed event has an invalid output array")
              }
              yield { type: "response.output-items", items: output }
              completed = true
              break
            } else if (event.type === "response.failed") {
              throw new Error(event.response?.error?.message ?? "Responses generation failed")
            } else if (event.type === "response.incomplete") {
              const reason = event.response?.incomplete_details?.reason
              throw new Error(`Responses generation was incomplete${reason ? `: ${reason}` : ""}`)
            } else if (event.type === "error") {
              throw new Error(event.error?.message ?? "Responses streaming failed")
            }
          }

          if (done && !completed) throw new Error("Responses stream ended before response.completed")
        }
      } finally {
        await reader.cancel().catch(() => {})
      }
      yield { type: "stream.finished" }
    } finally {
      signal?.removeEventListener("abort", forwardAbort)
    }
  }

  async close(): Promise<void> {
    await this.http.close()
  }
}

function enforceRequestMediaLimits(input: ResponseInputItem[]) {
  let inputFileBytes = 0
  let inputImagePayloadBytes = 0

  for (const item of input) {
    const content = getContent(item)
    if (!content) continue
    for (const part of content) {
      if (part.type === "input_file") {
        if (typeof part.file_data !== "string") throw new Error("input_file.file_data must be a Base64 data URL")
        const sourceBytes = getDataUrlDecodedBytes(part.file_data)
        if (sourceBytes >= RESPONSES_LIMITS.inputFileBytes) {
          throw new Error("Each input_file must be smaller than 40 MB")
        }
        inputFileBytes += sourceBytes
      } else if (part.type === "input_image" && typeof part.image_url === "string" && part.image_url.startsWith("data:")) {
        inputImagePayloadBytes += Buffer.byteLength(part.image_url, "utf8")
      }
    }
  }

  if (inputFileBytes >= RESPONSES_LIMITS.inputFilesPerRequestBytes) {
    throw new Error("The combined input_file content in this Responses request must be smaller than 40 MB")
  }
  if (inputImagePayloadBytes >= RESPONSES_LIMITS.inputImagesPerRequestBytes) {
    throw new Error("The combined serialized input_image payload in this Responses request must be smaller than 400 MB")
  }
}

function getContent(item: ResponseInputItem): Array<{ type: string; [key: string]: unknown }> | undefined {
  if (item.type === "function_call_output") {
    const output = (item as FunctionCallOutputItem).output
    return Array.isArray(output) ? output.filter(isRecord) as unknown as Array<{ type: string; [key: string]: unknown }> : undefined
  }
  if ("content" in item) {
    const content = (item as EasyInputMessage).content
    return Array.isArray(content) ? content.filter(isRecord) as unknown as Array<{ type: string; [key: string]: unknown }> : undefined
  }
  return undefined
}

function getDataUrlDecodedBytes(value: string): number {
  const comma = value.indexOf(",")
  if (comma < 0 || !value.slice(0, comma).endsWith(";base64")) {
    throw new Error("input_file.file_data must be a Base64 data URL")
  }
  const encoded = value.slice(comma + 1)
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error("input_file.file_data contains invalid Base64 data")
  }
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0
  return (encoded.length / 4) * 3 - padding
}

function parseResponsesEvent(data: string): ResponsesStreamEvent {
  let value: unknown
  try { value = JSON.parse(data) }
  catch (error) { throw new Error(`Invalid Responses stream event: ${error instanceof Error ? error.message : String(error)}`) }
  if (!isRecord(value) || typeof value.type !== "string") throw new Error("Invalid Responses stream event shape")
  return value as unknown as ResponsesStreamEvent
}

function extractSseLines(value: string, flush: boolean): {
  lines: Array<{ line: string; delimiterBytes: number }>
  remainder: string
} {
  const lines: Array<{ line: string; delimiterBytes: number }> = []
  let lineStart = 0
  let position = 0

  while (position < value.length) {
    const character = value[position]
    if (character !== "\r" && character !== "\n") {
      position += 1
      continue
    }
    if (character === "\r" && position === value.length - 1 && !flush) break

    const isCrLf = character === "\r" && value[position + 1] === "\n"
    const delimiterCharacters = isCrLf ? 2 : 1
    lines.push({ line: value.slice(lineStart, position), delimiterBytes: delimiterCharacters })
    position += delimiterCharacters
    lineStart = position
  }

  let remainder = value.slice(lineStart)
  if (flush && remainder) {
    lines.push({ line: remainder, delimiterBytes: 0 })
    remainder = ""
  }
  return { lines, remainder }
}

function isResponseOutputItem(value: unknown): value is ResponseOutputItem {
  return isRecord(value) && typeof value.type === "string"
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
