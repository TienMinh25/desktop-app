import { HARNESS_EVENT_TYPES } from "./message-types"
export { HARNESS_EVENT_TYPES } from "./message-types"

export interface BaseEvent { requestId: string }

export interface SessionEvent extends BaseEvent { sessionId: string }

export interface PongEvent extends BaseEvent {
  type: typeof HARNESS_EVENT_TYPES.PONG
}

export interface AssistantDeltaEvent extends SessionEvent {
  type: typeof HARNESS_EVENT_TYPES.ASSISTANT_DELTA
  text: string
}

export interface ChatCompletedEvent extends SessionEvent {
  type: typeof HARNESS_EVENT_TYPES.CHAT_COMPLETED
}

export interface ChatFailedEvent extends SessionEvent {
  type: typeof HARNESS_EVENT_TYPES.CHAT_FAILED
  message: string
}

export interface PermissionRequiredEvent extends SessionEvent {
  type: typeof HARNESS_EVENT_TYPES.PERMISSION_REQUIRED
  permissionRequestId: string
  tool: string
  action: string
  resource: string
  reason: string
}

export interface PermissionExpiredEvent extends SessionEvent {
  type: typeof HARNESS_EVENT_TYPES.PERMISSION_EXPIRED
  permissionRequestId: string
}

export interface QuestionRequiredEvent extends SessionEvent {
  type: typeof HARNESS_EVENT_TYPES.QUESTION_REQUIRED
  questionRequestId: string
  prompt: string
  choices?: string[]
}

export interface QuestionExpiredEvent extends SessionEvent {
  type: typeof HARNESS_EVENT_TYPES.QUESTION_EXPIRED
  questionRequestId: string
}

export interface TodoUpdatedEvent extends SessionEvent {
  type: typeof HARNESS_EVENT_TYPES.TODO_UPDATED
  todos: Array<{ content: string; status: "pending" | "in_progress" | "completed" }>
}

export interface ToolStartedEvent extends SessionEvent {
  type: typeof HARNESS_EVENT_TYPES.TOOL_STARTED
  toolCallId: string
  toolName: string
}

export interface ToolCompletedEvent extends SessionEvent {
  type: typeof HARNESS_EVENT_TYPES.TOOL_COMPLETED
  toolCallId: string
  toolName: string
}

export interface ToolFailedEvent extends SessionEvent {
  type: typeof HARNESS_EVENT_TYPES.TOOL_FAILED
  toolCallId: string
  toolName: string
  message: string
}

export type HarnessEvent = PongEvent | AssistantDeltaEvent | ChatCompletedEvent | ChatFailedEvent | PermissionRequiredEvent | PermissionExpiredEvent | QuestionRequiredEvent | QuestionExpiredEvent | TodoUpdatedEvent | ToolStartedEvent | ToolCompletedEvent | ToolFailedEvent
