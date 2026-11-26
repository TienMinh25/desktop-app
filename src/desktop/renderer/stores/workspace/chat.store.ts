import type { HarnessEvent } from "../../../../contracts/events"
import { HARNESS_COMMAND_TYPES, HARNESS_EVENT_TYPES } from "../../../../contracts/message-types"
import type { ApprovalMode } from "../../../../contracts/permissions"
import type { TodoItem } from "../../../../contracts/todos"
import { createAppStore } from "../create-store"

const CHAT_ACTIONS = {
  PERMISSION_RESPONSE: "chat/permissionResponse",
  QUESTION_RESPONSE: "chat/questionResponse",
  STOP_GENERATION: "chat/stopGeneration",
  QUEUE_ADD: "chat/queueAdd",
  QUEUE_EDIT: "chat/queueEdit",
  QUEUE_DELETE: "chat/queueDelete",
  QUEUE_SEND_NOW: "chat/queueSendNow",
  INIT_QC_MOCK: "chat/initQcMock",
  CLEAR_SESSION: "chat/clearSession",
  RESET: "chat/reset",
} as const

export const QC_MOCK_SESSION_ID = "qc-mock-session"

export interface QueuedPromptItem {
  requestId: string
  prompt: string
  model?: string
  workspacePath?: string
  approvalMode?: ApprovalMode
}

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
  queuedPrompts: Record<string, QueuedPromptItem[]>

  actions: {
    subscribeHarness: () => () => void
    sendPrompt: (params: {
      sessionId: string
      prompt: string
      model: string
      workspacePath?: string
      approvalMode: ApprovalMode
    }) => void
    stopGeneration: (sessionId: string) => void
    sendQueuedPromptNow: (sessionId: string, requestId: string) => void
    editQueuedPrompt: (sessionId: string, requestId: string, nextPrompt: string) => void
    deleteQueuedPrompt: (sessionId: string, requestId: string) => void
    respondToPermission: (sessionId: string, requestId: string, permissionId: string, decision: "allow" | "deny") => void
    respondToQuestion: (sessionId: string, requestId: string, questionId: string, answer: string) => void
    initQcMockSession: () => void
    clearSessionRuntime: (sessionId: string) => void
    reset: () => void
  }
}

export const useChatStore = createAppStore<ChatStoreState>("ChatStore", (set, get) => {
  const dispatchToHarness = (params: {
    requestId?: string
    sessionId: string
    prompt: string
    model: string
    workspacePath?: string
    approvalMode: ApprovalMode
  }) => {
    window.desktop.sendHarnessCommand({
      type: HARNESS_COMMAND_TYPES.CHAT_SUBMIT,
      requestId: params.requestId ?? crypto.randomUUID(),
      sessionId: params.sessionId,
      prompt: params.prompt,
      model: params.model,
      workspacePath: params.workspacePath,
      approvalMode: params.approvalMode,
    })
  }

  const flushNextQueuedPrompt = (sessionId: string) => {
    const queue = get().queuedPrompts[sessionId] ?? []
    const next = queue[0]
    if (!next || !next.model || !next.approvalMode) return
    set(
      (state) => ({
        queuedPrompts: {
          ...state.queuedPrompts,
          [sessionId]: (state.queuedPrompts[sessionId] ?? []).slice(1),
        },
      }),
      false,
      CHAT_ACTIONS.QUEUE_SEND_NOW,
    )
    dispatchToHarness({
      requestId: next.requestId,
      sessionId,
      prompt: next.prompt,
      model: next.model,
      workspacePath: next.workspacePath,
      approvalMode: next.approvalMode,
    })
  }
  const handleEvent = (event: HarnessEvent) => {
    if (event.type === HARNESS_EVENT_TYPES.PONG) return
    switch (event.type) {
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
        flushNextQueuedPrompt(event.sessionId)
        return
      case HARNESS_EVENT_TYPES.CHAT_FAILED:
        set(
          (state) => ({
            queuedPrompts: {
              ...state.queuedPrompts,
              [event.sessionId]: (state.queuedPrompts[event.sessionId] ?? []).filter(
                (item) => item.requestId !== event.requestId,
              ),
            },
            turns: updateMatchingTurn(state.turns, event.sessionId, event.requestId, (turn) => ({
              ...turn,
              isStreaming: false,
              error: event.message,
            })),
          }),
          false,
          event.type,
        )
        flushNextQueuedPrompt(event.sessionId)
        return
      default:
        return assertNever(event)
    }
  }

  return {
    turns: {},
    queuedPrompts: {},

    actions: {
      subscribeHarness: () => window.desktop.subscribeHarnessEvents(handleEvent),

    sendPrompt: ({ sessionId, prompt, model, workspacePath, approvalMode }) => {
      const currentTurn = get().turns[sessionId]
      if (currentTurn?.isStreaming) {
        set(
          (state) => ({
            queuedPrompts: {
              ...state.queuedPrompts,
              [sessionId]: [
                ...(state.queuedPrompts[sessionId] ?? []),
                { requestId: crypto.randomUUID(), prompt, model, workspacePath, approvalMode },
              ],
            },
          }),
          false,
          CHAT_ACTIONS.QUEUE_ADD,
        )
        return
      }

      if (sessionId === QC_MOCK_SESSION_ID) {
        set(
          (state) => ({
            turns: {
              ...state.turns,
              [sessionId]: {
                requestId: crypto.randomUUID(),
                sessionId,
                prompt,
                assistantText: `[QC Mock] Started streaming response for: "${prompt}"`,
                isStreaming: true,
                error: null,
                permission: null,
                question: state.turns[sessionId]?.question ?? null,
                todos: state.turns[sessionId]?.todos ?? [],
                toolStatus: "Simulating streaming response…",
              },
            },
          }),
          false,
          CHAT_ACTIONS.INIT_QC_MOCK,
        )
        return
      }

      dispatchToHarness({ sessionId, prompt, model, workspacePath, approvalMode })
    },

    stopGeneration: (sessionId) => {
      if (sessionId !== QC_MOCK_SESSION_ID) {
        window.desktop.sendHarnessCommand({
          type: HARNESS_COMMAND_TYPES.CHAT_CANCEL,
          sessionId,
        })
      }
      set(
        (state) => {
          const turn = state.turns[sessionId]
          if (!turn) return state
          return {
            turns: {
              ...state.turns,
              [sessionId]: {
                ...turn,
                isStreaming: false,
                toolStatus: null,
              },
            },
          }
        },
        false,
        CHAT_ACTIONS.STOP_GENERATION,
      )
    },

    sendQueuedPromptNow: (sessionId, requestId) => {
      const queue = get().queuedPrompts[sessionId] ?? []
      const target = queue.find((item) => item.requestId === requestId)
      if (!target) return

      const remaining = queue.filter((item) => item.requestId !== requestId)
      if (get().turns[sessionId]?.isStreaming) {
        get().actions.stopGeneration(sessionId)
      }

      set(
        (state) => ({
          queuedPrompts: { ...state.queuedPrompts, [sessionId]: remaining },
        }),
        false,
        CHAT_ACTIONS.QUEUE_SEND_NOW,
      )

      if (sessionId === QC_MOCK_SESSION_ID) {
        set(
          (state) => ({
            turns: {
              ...state.turns,
              [sessionId]: {
                requestId: target.requestId,
                sessionId,
                prompt: target.prompt,
                assistantText: `[QC Mock] Sent queued message immediately: "${target.prompt}"`,
                isStreaming: true,
                error: null,
                permission: null,
                question: state.turns[sessionId]?.question ?? null,
                todos: state.turns[sessionId]?.todos ?? [],
                toolStatus: "Simulating streaming response…",
              },
            },
          }),
          false,
          CHAT_ACTIONS.QUEUE_SEND_NOW,
        )
        return
      }

      if (target.model && target.approvalMode) {
        dispatchToHarness({
          requestId: target.requestId,
          sessionId,
          prompt: target.prompt,
          model: target.model,
          workspacePath: target.workspacePath,
          approvalMode: target.approvalMode,
        })
      }
    },

    editQueuedPrompt: (sessionId, requestId, nextPrompt) => {
      const trimmed = nextPrompt.trim()
      if (!trimmed) return
      set(
        (state) => ({
          queuedPrompts: {
            ...state.queuedPrompts,
            [sessionId]: (state.queuedPrompts[sessionId] ?? []).map((item) =>
              item.requestId === requestId ? { ...item, prompt: trimmed } : item,
            ),
          },
        }),
        false,
        CHAT_ACTIONS.QUEUE_EDIT,
      )
    },

    deleteQueuedPrompt: (sessionId, requestId) => {
      set(
        (state) => ({
          queuedPrompts: {
            ...state.queuedPrompts,
            [sessionId]: (state.queuedPrompts[sessionId] ?? []).filter(
              (item) => item.requestId !== requestId,
            ),
          },
        }),
        false,
        CHAT_ACTIONS.QUEUE_DELETE,
      )
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
      if (sessionId !== QC_MOCK_SESSION_ID) {
        window.desktop.respondToQuestion(questionId, answer)
      }
      set(
        (state) => ({
          turns: updateMatchingTurn(state.turns, sessionId, requestId, (turn) => ({
            ...turn,
            question: null,
            assistantText:
              sessionId === QC_MOCK_SESSION_ID
                ? `${turn.assistantText}\n\n✓ Selected answer: ${answer}`
                : turn.assistantText,
          })),
        }),
        false,
        CHAT_ACTIONS.QUESTION_RESPONSE,
      )
    },

    initQcMockSession: () => {
      set(
        (state) => ({
          turns: {
            ...state.turns,
            [QC_MOCK_SESSION_ID]: state.turns[QC_MOCK_SESSION_ID] ?? {
              requestId: "qc-mock-request-1",
              sessionId: QC_MOCK_SESSION_ID,
              prompt:
                "Implement a complete user authentication flow with email/password login, registration, password reset, and email verification. Use JWT tokens for session management and bcrypt for password hashing.",
              assistantText:
                "I'll implement a comprehensive authentication system. Let me start by analyzing the current project structure and then build the authentication flow step by step.",
              isStreaming: true,
              error: null,
              permission: null,
              question: {
                id: "qc-mock-question-1",
                prompt:
                  "Session storage strategy\nI need to know your preference for storing JWT tokens on the client side. This affects security vs. convenience tradeoffs.",
                choices: [
                  "HttpOnly Cookies (Recommended)\nMost secure. Tokens stored in httpOnly cookies, immune to XSS attacks. Works well for web apps but requires CORS setup.",
                  "LocalStorage\nEasier implementation, accessible from JavaScript. Vulnerable to XSS attacks but suitable for internal tools with trusted code.",
                  "Memory Only (SPA)\nTokens stored in memory, lost on refresh. Highest security but requires refresh token flow and persistence strategy.",
                ],
              },
              todos: [
                { id: "qc-todo-1", content: "Create user model with password hashing", status: "completed", priority: "high" },
                { id: "qc-todo-2", content: "Implement JWT token generation and validation", status: "in_progress", priority: "high" },
                { id: "qc-todo-3", content: "Add rate limiting headers to login endpoint", status: "pending", priority: "medium" },
              ],
              toolStatus: "Read 5 files, analyzed existing auth structure",
            },
          },
          queuedPrompts: {
            ...state.queuedPrompts,
            [QC_MOCK_SESSION_ID]: state.queuedPrompts[QC_MOCK_SESSION_ID] ?? [
              {
                requestId: "qc-q-1",
                prompt: "Verify token expiration handling in middleware and write unit test",
              },
              {
                requestId: "qc-q-2",
                prompt: "Add rate limiting headers to the login endpoint response",
              },
            ],
          },
        }),
        false,
        CHAT_ACTIONS.INIT_QC_MOCK,
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
    },
  }
})
