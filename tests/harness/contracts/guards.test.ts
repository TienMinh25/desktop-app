import { expect, it } from "bun:test"
import { HARNESS_COMMAND_TYPES } from "../../../src/contracts/message-types"
import { isHarnessCommand } from "../../../src/contracts/guards"

it("exposes the command discriminants from the shared contract", () => {
  expect(HARNESS_COMMAND_TYPES).toEqual({
    PING: "app.ping",
    CHAT_SUBMIT: "chat.submit",
    PERMISSION_RESPOND: "permission.respond",
    QUESTION_RESPOND: "question.respond",
  })
})

it("accepts a chat submit with no selected workspace and a valid approval mode", () => {
  expect(isHarnessCommand({
    type: "chat.submit",
    requestId: "request-1",
    sessionId: "session-1",
    prompt: "Create a file in my home folder",
    model: "test-model",
    approvalMode: "manual",
  })).toBe(true)
})

it("rejects unknown approval modes at the process boundary", () => {
  expect(isHarnessCommand({
    type: "chat.submit",
    requestId: "request-1",
    sessionId: "session-1",
    prompt: "hello",
    model: "test-model",
    approvalMode: "automatic",
  })).toBe(false)
})

it("rejects extra properties because IPC objects are strict schemas", () => {
  expect(isHarnessCommand({ type: "app.ping", requestId: "r1", unexpected: true })).toBe(false)
})

it("accepts a typed user-question response and rejects malformed responses", () => {
  expect(isHarnessCommand({ type: "question.respond", questionRequestId: "q1", answer: "Choose option B" })).toBe(true)
  expect(isHarnessCommand({ type: "question.respond", questionRequestId: "", answer: "answer" })).toBe(false)
  expect(isHarnessCommand({ type: "question.respond", questionRequestId: "q1", answer: "x".repeat(10_001) })).toBe(false)
})
