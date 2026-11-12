import { expect, it } from "bun:test"
import { HARNESS_EVENT_TYPES } from "../../../src/contracts/message-types"

it("exposes the event discriminants from the shared contract", () => {
  expect(HARNESS_EVENT_TYPES).toEqual({
    PONG: "app.pong",
    ASSISTANT_DELTA: "assistant.delta",
    CHAT_COMPLETED: "chat.completed",
    CHAT_FAILED: "chat.failed",
    PERMISSION_REQUIRED: "permission.required",
    PERMISSION_EXPIRED: "permission.expired",
    QUESTION_REQUIRED: "question.required",
    QUESTION_EXPIRED: "question.expired",
    TODO_UPDATED: "todo.updated",
    TOOL_STARTED: "tool.started",
    TOOL_COMPLETED: "tool.completed",
    TOOL_FAILED: "tool.failed",
  })
})
