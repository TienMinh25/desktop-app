export const HARNESS_COMMAND_TYPES = {
  PING: "app.ping",
  CHAT_SUBMIT: "chat.submit",
  SESSION_DELETE: "session.delete",
  PERMISSION_RESPOND: "permission.respond",
  QUESTION_RESPOND: "question.respond",
  LSP_CONFIGURE: "lsp.configure",
} as const

export const HARNESS_EVENT_TYPES = {
  PONG: "app.pong",
  HARNESS_READY: "harness.ready",
  HARNESS_EXITED: "harness.exited",
  ASSISTANT_DELTA: "assistant.delta",
  CHAT_COMPLETED: "chat.completed",
  CHAT_FAILED: "chat.failed",
  CHAT_QUEUED: "chat.queued",
  CHAT_STARTED: "chat.started",
  CONTEXT_WARNING: "context.warning",
  PERMISSION_REQUIRED: "permission.required",
  PERMISSION_EXPIRED: "permission.expired",
  QUESTION_REQUIRED: "question.required",
  QUESTION_EXPIRED: "question.expired",
  TODO_UPDATED: "todo.updated",
  TOOL_STARTED: "tool.started",
  TOOL_COMPLETED: "tool.completed",
  TOOL_FAILED: "tool.failed",
} as const
