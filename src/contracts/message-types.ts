export const HARNESS_COMMAND_TYPES = {
  PING: "app.ping",
  CHAT_SUBMIT: "chat.submit",
  PERMISSION_RESPOND: "permission.respond",
  QUESTION_RESPOND: "question.respond",
} as const

export const HARNESS_EVENT_TYPES = {
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
} as const
