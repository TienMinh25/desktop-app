import type { HarnessEvent } from "../../../../contracts/events"
import { HARNESS_COMMAND_TYPES, HARNESS_EVENT_TYPES } from "../../../../contracts/message-types"
import type { ApprovalMode } from "../../../../contracts/permissions"
import type { TodoItem } from "../../../../contracts/todos"
import { createAppStore } from "../create-store"

const CHAT_ACTIONS = {
  PERMISSION_RESPONSE: "chat/permissionResponse",
  QUESTION_RESPONSE: "chat/questionResponse",
  CLEAR_SESSION: "chat/clearSession",
  RESET: "chat/reset",
} as const

export interface TurnState {
  requestId: string
  sessionId: string
  prompt: string
  assistantText: string
  isStreaming: boolean
  error: string | null
  permission: { id: string; tool: string; action: string; resource: string; reason: string } | null
  question: { id: string; prompt: string; choices?: string[] } | null
  todos: TodoItem[]
  toolStatus: string | null
}

function updateMatchingTurn(
  turns: Record<string, TurnState>,
  sessionId: string,
  requestId: string,
  update: (turn: TurnState) => TurnState,
): Record<string, TurnState> {
  const turn = turns[sessionId]
  if (!turn || turn.requestId !== requestId) return turns
  return { ...turns, [sessionId]: update(turn) }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled harness event: ${JSON.stringify(value)}`)
}

interface ChatStoreState {
  turns: Record<string, TurnState>
  queuedPrompts: Record<string, Array<{ requestId: string; prompt: string }>>

  subscribeHarness: () => () => void
  sendPrompt: (params: {
    sessionId: string
    prompt: string
    model: string
    workspacePath?: string
    approvalMode: ApprovalMode
  }) => void
  respondToPermission: (sessionId: string, requestId: string, permissionId: string, decision: "allow" | "deny") => void
  respondToQuestion: (sessionId: string, requestId: string, questionId: string, answer: string) => void
  clearSessionRuntime: (sessionId: string) => void
  reset: () => void
}

export const useChatStore = createAppStore<ChatStoreState>("ChatStore", (set) => {
  const handleEvent = (event: HarnessEvent) => {
    if (event.type === HARNESS_EVENT_TYPES.PONG || event.type === HARNESS_EVENT_TYPES.HARNESS_READY) return
    switch (event.type) {
      case HARNESS_EVENT_TYPES.HARNESS_EXITED:
        set(
          (state) => {
            const turns: Record<string, TurnState> = {}
            for (const [sessionId, turn] of Object.entries(state.turns)) {
              turns[sessionId] = turn.isStreaming
                ? {
                    ...turn,
                    isStreaming: false,
                    error: "The harness stopped. Prompts that were waiting were lost.",
                    permission: null,
                    question: null,
                    toolStatus: null,
                  }
                : turn
            }
            return { turns, queuedPrompts: {} }
          },
          false,
          event.type,
        )
        return
      case HARNESS_EVENT_TYPES.CHAT_QUEUED:
        set(
          (state) => {
            const queue = [...(state.queuedPrompts[event.sessionId] ?? [])]
            const index = Math.min(queue.length, Math.max(0, event.queuePosition - 1))
            queue.splice(index, 0, { requestId: event.requestId, prompt: event.prompt })
            return {
              queuedPrompts: { ...state.queuedPrompts, [event.sessionId]: queue },
            }
          },
          false,
          event.type,
        )
        return
      case HARNESS_EVENT_TYPES.CHAT_STARTED:
        set(
          (state) => ({
            queuedPrompts: {
              ...state.queuedPrompts,
              [event.sessionId]: (state.queuedPrompts[event.sessionId] ?? []).filter(
                (item) => item.requestId !== event.requestId,
              ),
            },
            turns: {
              ...state.turns,
              [event.sessionId]: {
                requestId: event.requestId,
                sessionId: event.sessionId,
                prompt: event.prompt,
                assistantText: "",
                isStreaming: true,
                error: null,
                permission: null,
                question: null,
                todos: [],
                toolStatus: null,
              },
            },
          }),
          false,
          event.type,
        )
        return
      case HARNESS_EVENT_TYPES.ASSISTANT_DELTA:
        set(
          (state) => ({
            turns: updateMatchingTurn(state.turns, event.sessionId, event.requestId, (turn) => ({
              ...turn,
              assistantText: turn.assistantText + event.text,
            })),
          }),
          false,
          event.type,
        )
        return
      case HARNESS_EVENT_TYPES.PERMISSION_REQUIRED:
        set(
          (state) => ({
            turns: updateMatchingTurn(state.turns, event.sessionId, event.requestId, (turn) => ({
              ...turn,
              permission: {
                id: event.permissionRequestId,
                tool: event.tool,
                action: event.action,
                resource: event.resource,
                reason: event.reason,
              },
            })),
          }),
          false,
          event.type,
        )
        return
      case HARNESS_EVENT_TYPES.PERMISSION_EXPIRED:
        set(
          (state) => ({
            turns: updateMatchingTurn(state.turns, event.sessionId, event.requestId, (turn) => ({
              ...turn,
              permission: null,
              error: "Permission request expired. The operation was denied.",
            })),
          }),
          false,
          event.type,
        )
        return
      case HARNESS_EVENT_TYPES.QUESTION_REQUIRED:
        set(
          (state) => ({
            turns: updateMatchingTurn(state.turns, event.sessionId, event.requestId, (turn) => ({
              ...turn,
              question: { id: event.questionRequestId, prompt: event.prompt, choices: event.choices },
            })),
          }),
          false,
          event.type,
        )
        return
      case HARNESS_EVENT_TYPES.QUESTION_EXPIRED:
        set(
          (state) => ({
            turns: updateMatchingTurn(state.turns, event.sessionId, event.requestId, (turn) => ({
              ...turn,
              question: null,
              error: "The question timed out. The agent can continue without an answer.",
            })),
          }),
          false,
          event.type,
        )
        return
      case HARNESS_EVENT_TYPES.TODO_UPDATED:
        set(
          (state) => ({
            turns: updateMatchingTurn(state.turns, event.sessionId, event.requestId, (turn) => ({
              ...turn,
              todos: event.todos,
            })),
          }),
          false,
          event.type,
        )
        return
      case HARNESS_EVENT_TYPES.TOOL_STARTED:
        set(
          (state) => ({
            turns: updateMatchingTurn(state.turns, event.sessionId, event.requestId, (turn) => ({
              ...turn,
              toolStatus: `Running ${event.toolName}…`,
            })),
          }),
          false,
          event.type,
        )
        return
      case HARNESS_EVENT_TYPES.TOOL_COMPLETED:
        set(
          (state) => ({
            turns: updateMatchingTurn(state.turns, event.sessionId, event.requestId, (turn) => ({
              ...turn,
              toolStatus: null,
            })),
          }),
          false,
          event.type,
        )
        return
      case HARNESS_EVENT_TYPES.TOOL_FAILED:
        set(
          (state) => ({
            turns: updateMatchingTurn(state.turns, event.sessionId, event.requestId, (turn) => ({
              ...turn,
              toolStatus: `${event.toolName} failed: ${event.message}`,
            })),
          }),
          false,
          event.type,
        )
        return
      case HARNESS_EVENT_TYPES.CONTEXT_WARNING:
        set(
          (state) => ({
            turns: updateMatchingTurn(state.turns, event.sessionId, event.requestId, (turn) => ({
              ...turn,
              error: turn.error ? `${turn.error}\n${event.message}` : event.message,
            })),
          }),
          false,
          event.type,
        )
        return
      case HARNESS_EVENT_TYPES.CHAT_COMPLETED:
        set(
          (state) => ({
            turns: updateMatchingTurn(state.turns, event.sessionId, event.requestId, (turn) => ({
              ...turn,
              isStreaming: false,
            })),
          }),
          false,
          event.type,
        )
        return
      case HARNESS_EVENT_TYPES.CHAT_FAILED:
        set(
          (state) => {
            const queued = state.queuedPrompts[event.sessionId] ?? []
            const existing = state.turns[event.sessionId]
            const queuedPrompts = {
              ...state.queuedPrompts,
              [event.sessionId]: queued.filter((item) => item.requestId !== event.requestId),
            }
            if (existing?.isStreaming && existing.requestId !== event.requestId) return { queuedPrompts }
            const turn = existing?.requestId === event.requestId ? existing : {
              requestId: event.requestId,
              sessionId: event.sessionId,
              prompt: event.prompt,
              assistantText: "",
              permission: null,
              question: null,
              todos: [],
              toolStatus: null,
            }
            return {
              queuedPrompts,
              turns: {
                ...state.turns,
                [event.sessionId]: { ...turn, isStreaming: false, error: event.message },
              },
            }
          },
          false,
          event.type,
        )
        return
      default:
        return assertNever(event)
    }
  }

  return {
    turns: {},
    queuedPrompts: {},

    subscribeHarness: () => window.desktop.subscribeHarnessEvents(handleEvent),

    sendPrompt: ({ sessionId, prompt, model, workspacePath, approvalMode }) => {
      window.desktop.sendHarnessCommand({
        type: HARNESS_COMMAND_TYPES.CHAT_SUBMIT,
        requestId: crypto.randomUUID(),
        sessionId,
        prompt,
        model,
        workspacePath,
        approvalMode,
      })
    },

    respondToPermission: (sessionId, requestId, permissionId, decision) => {
      window.desktop.respondToPermission(permissionId, decision)
      set(
        (state) => ({
          turns: updateMatchingTurn(state.turns, sessionId, requestId, (turn) => ({
            ...turn,
            permission: null,
          })),
        }),
        false,
        CHAT_ACTIONS.PERMISSION_RESPONSE,
      )
    },

    respondToQuestion: (sessionId, requestId, questionId, answer) => {
      window.desktop.respondToQuestion(questionId, answer)
      set(
        (state) => ({
          turns: updateMatchingTurn(state.turns, sessionId, requestId, (turn) => ({
            ...turn,
            question: null,
          })),
        }),
        false,
        CHAT_ACTIONS.QUESTION_RESPONSE,
      )
    },

    clearSessionRuntime: (sessionId) => {
      window.desktop.sendHarnessCommand({
        type: HARNESS_COMMAND_TYPES.SESSION_DELETE,
        sessionId,
      })
      set(
        (state) => {
          const nextTurns = { ...state.turns }
          const nextQueue = { ...state.queuedPrompts }
          delete nextTurns[sessionId]
          delete nextQueue[sessionId]
          return { turns: nextTurns, queuedPrompts: nextQueue }
        },
        false,
        CHAT_ACTIONS.CLEAR_SESSION,
      )
    },

    reset: () => set({ turns: {}, queuedPrompts: {} }, false, CHAT_ACTIONS.RESET),
  }
})
