import { expect, it, spyOn } from "bun:test"
import { Headers, Response } from "undici"
import type { Response as UndiciResponse } from "undici-types"
import type { BackendFetch } from "../../../src/infrastructure/http/backend-http-client"
import { BackendHttpClient } from "../../../src/infrastructure/http/backend-http-client"
import { ChatClient } from "../../../src/domain/chat/chat-client"
import { logger } from "../../../src/infrastructure/logging/logger"

function sseResponse(...events: string[]): UndiciResponse {
  return new Response(events.join(""), { status: 200, headers: { "content-type": "text/event-stream" } })
}

function createChatClient(fetchImpl: BackendFetch, model = "configured-model") {
  const tokenProvider = {
    async getAccessToken() { return "test-token" },
    async refreshAccessToken() { return "refreshed-token" },
    async expireSession() {},
  }
  const backend = new BackendHttpClient("https://company.test", tokenProvider, undefined, fetchImpl)
  return new ChatClient({ model }, backend)
}

it("sends the configured model and streams Responses text and output items", async () => {
  let sentBody: Record<string, unknown> | undefined
  const captured = { authorization: null as string | null }
  const callItem = { type: "function_call", id: "fc-1", call_id: "call-1", name: "read", arguments: JSON.stringify({ path: "a.ts" }) }
  const client = createChatClient(async (_input, init) => {
    sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    captured.authorization = new Headers(init?.headers).get("authorization")
    return sseResponse(
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "hello" })}\n\n`,
      `data: ${JSON.stringify({ type: "response.completed", response: { output: [callItem] } })}\n\n`,
      "data: [DONE]\n\n",
    )
  })

  try {
    const events = []
    for await (const event of client.stream({ model: "request-model", input: [{ role: "user", content: "hi" }], project_id: 1 })) events.push(event)

    expect(sentBody).not.toHaveProperty("stream")
    expect(sentBody).toMatchObject({ project_id: 1, model: "configured-model", input: [{ role: "user", content: "hi" }] })
    expect(captured.authorization).toBe("Bearer test-token")
    expect(events).toEqual([
      { type: "text.delta", text: "hello" },
      { type: "response.output-items", items: [callItem] },
      { type: "stream.finished" },
    ])
  } finally {
    await client.close()
  }
})

it("accepts a Responses SSE frame larger than 1 MB", async () => {
  const largeArgument = "x".repeat(1_100_000)
  const callItem = { type: "function_call", id: "fc-large", call_id: "call-large", name: "write", arguments: JSON.stringify({ path: "large.txt", content: largeArgument }) }
  const client = createChatClient(async () => sseResponse(`data: ${JSON.stringify({ type: "response.completed", response: { output: [callItem] } })}\n\n`))
  try {
    const events = []
    for await (const event of client.stream({ model: "model", input: [], project_id: 1 })) events.push(event)
    expect(events[0]).toMatchObject({ type: "response.output-items", items: [callItem] })
  } finally {
    await client.close()
  }
})

it("returns endpoint errors and rejects malformed Responses SSE frames", async () => {
  const logError = spyOn(logger, "apiError")
  const failed = createChatClient(async () => new Response("backend unavailable", { status: 503 }), "model")
  try {
    await expect(async () => {
      for await (const _event of failed.stream({ model: "model", input: [], project_id: 1 })) {}
    }).toThrow(/^Responses endpoint returned 503$/)
    expect(logError).toHaveBeenCalledWith("POST", "api/v1/chat/responses", expect.stringContaining("backend unavailable"), expect.any(Number))
  } finally {
    logError.mockRestore()
    await failed.close()
  }

  const malformed = createChatClient(async () => sseResponse("data: {bad json}\n\n"), "model")
  try {
    await expect(async () => {
      for await (const _event of malformed.stream({ model: "model", input: [], project_id: 1 })) {}
    }).toThrow("Invalid Responses stream event")
  } finally {
    await malformed.close()
  }

  const malformedShape = createChatClient(async () => sseResponse('data: {"type":"response.completed","response":{"output":"not-an-array"}}\n\n'), "model")
  try {
    await expect(async () => {
      for await (const _event of malformedShape.stream({ model: "model", input: [], project_id: 1 })) {}
    }).toThrow("invalid output array")
  } finally {
    await malformedShape.close()
  }
})

it("keeps the HTTP status when the error response body cannot be read", async () => {
  async function* brokenBody() {
    yield Buffer.from("private detail")
    throw new Error("connection interrupted")
  }
  const client = createChatClient(async () => new Response(brokenBody(), { status: 502 }))
  try {
    await expect(async () => {
      for await (const _event of client.stream({ model: "model", input: [], project_id: 1 })) {}
    }).toThrow(/^Responses endpoint returned 502$/)
  } finally {
    await client.close()
  }
})

const deltaFrame = 'data: {"type":"response.output_text.delta","delta":"partial"}\n\n'
const prematureEnd = "Responses stream ended before response.completed"

it.each([
  ["[DONE]", "data: [DONE]\n\n", prematureEnd],
  ["[DONE] before a later completion", 'data: [DONE]\n\ndata: {"type":"response.completed","response":{"output":[]}}\n\n', prematureEnd],
  ["EOF after a delta", deltaFrame, prematureEnd],
  ["response.failed", 'data: {"type":"response.failed","response":{"error":{"message":"quota exceeded"}}}\n\n', "quota exceeded"],
  ["response.incomplete", 'data: {"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}\n\n', "Responses generation was incomplete: max_output_tokens"],
  ["error", 'data: {"type":"error","error":{"message":"upstream reset"}}\n\n', "upstream reset"],
])("rejects %s before response.completed", async (_name, frames, message) => {
  const client = createChatClient(async () => sseResponse(frames))
  try {
    await expect(async () => {
      for await (const _event of client.stream({ model: "model", input: [], project_id: 1 })) {}
    }).toThrow(message)
  } finally {
    await client.close()
  }
})
