import { expect, it } from "bun:test"
import { Headers, Response } from "undici"
import type { Response as UndiciResponse } from "undici-types"
import type { UndiciFetch } from "../../../src/infrastructure/http/http-client"
import { ChatClient } from "../../../src/domain/chat/chat-client"

function sseResponse(...events: string[]): UndiciResponse {
  return new Response(events.join(""), { status: 200, headers: { "content-type": "text/event-stream" } })
}

function fetchStub(handler: UndiciFetch): UndiciFetch {
  return handler
}

it("sends the configured model and streams text and tool-call deltas", async () => {
  let sentBody: Record<string, unknown> | undefined
  const requestCapture: { authorization: string | null } = { authorization: null }
  const client = new ChatClient({ endpoint: "https://company.test/v1/chat/completions", model: "configured-model", accessToken: "test-token" }, fetchStub(async (_input, init) => {
    sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    requestCapture.authorization = new Headers(init?.headers).get("authorization")
    return sseResponse(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "hello" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", function: { name: "read", arguments: "{\\\"path\\\":" } }] } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\\\"a.ts\\\"}" } }] } }] })}\n\n`,
      "data: [DONE]\n\n",
    )
  }))
  const events = []
  for await (const event of client.stream({ model: "request-model", messages: [{ role: "user", content: "hi" }], stream: true })) events.push(event)

  expect(sentBody).toMatchObject({ model: "configured-model", stream: true })
  expect(requestCapture.authorization).toBe("Bearer test-token")
  expect(events).toEqual([
    { type: "text.delta", text: "hello" },
    { type: "tool-call.delta", index: 0, id: "call-1", name: "read", argumentsDelta: "{\\\"path\\\":" },
    { type: "tool-call.delta", index: 0, id: undefined, name: undefined, argumentsDelta: "\\\"a.ts\\\"}" },
    { type: "stream.finished" },
  ])
})

it("returns endpoint errors and rejects malformed SSE frames", async () => {
  const failed = new ChatClient({ endpoint: "https://company.test/chat", model: "model", accessToken: "test-token" }, fetchStub(async () => new Response("backend unavailable", { status: 503 })))
  await expect(async () => { for await (const _event of failed.stream({ model: "model", messages: [], stream: true })) {} }).toThrow("Chat endpoint returned 503: backend unavailable")

  const malformed = new ChatClient({ endpoint: "https://company.test/chat", model: "model", accessToken: "test-token" }, fetchStub(async () => sseResponse("data: {bad json}\n\n")))
  await expect(async () => { for await (const _event of malformed.stream({ model: "model", messages: [], stream: true })) {} }).toThrow()

  const malformedShape = new ChatClient({ endpoint: "https://company.test/chat", model: "model", accessToken: "test-token" }, fetchStub(async () => sseResponse('data: {"choices":"not-an-array"}\n\n')))
  await expect(async () => { for await (const _event of malformedShape.stream({ model: "model", messages: [], stream: true })) {} }).toThrow("Invalid Chat Completions stream chunk")
})
