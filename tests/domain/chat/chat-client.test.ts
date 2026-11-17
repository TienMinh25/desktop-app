import { expect, it } from "bun:test"
import { Headers, Response } from "undici"
import type { Response as UndiciResponse } from "undici-types"
import type { BackendFetch } from "../../../src/infrastructure/http/backend-http-client"
import { BackendHttpClient } from "../../../src/infrastructure/http/backend-http-client"
import { ChatClient } from "../../../src/domain/chat/chat-client"

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
    )
  })

  try {
    const events = []
    for await (const event of client.stream({ model: "request-model", input: [{ role: "user", content: "hi" }], stream: true })) events.push(event)

    expect(sentBody).toMatchObject({ model: "configured-model", stream: true, input: [{ role: "user", content: "hi" }] })
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

it("returns endpoint errors and rejects malformed Responses SSE frames", async () => {
  const failed = createChatClient(async () => new Response("backend unavailable", { status: 503 }), "model")
  try {
    await expect(async () => {
      for await (const _event of failed.stream({ model: "model", input: [], stream: true })) {}
    }).toThrow("Responses endpoint returned 503: backend unavailable")
  } finally {
    await failed.close()
  }

  const malformed = createChatClient(async () => sseResponse("data: {bad json}\n\n"), "model")
  try {
    await expect(async () => {
      for await (const _event of malformed.stream({ model: "model", input: [], stream: true })) {}
    }).toThrow("Invalid Responses stream event")
  } finally {
    await malformed.close()
  }

  const malformedShape = createChatClient(async () => sseResponse('data: {"type":"response.completed","response":{"output":"not-an-array"}}\n\n'), "model")
  try {
    await expect(async () => {
      for await (const _event of malformedShape.stream({ model: "model", input: [], stream: true })) {}
    }).toThrow("invalid output array")
  } finally {
    await malformedShape.close()
  }
})
