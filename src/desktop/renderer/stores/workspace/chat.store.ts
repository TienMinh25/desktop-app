import { SubmitPromptCommandSchema } from "../../../../contracts/commands"
import type { HarnessEvent } from "../../../../contracts/events"
import { HARNESS_COMMAND_TYPES, HARNESS_EVENT_TYPES } from "../../../../contracts/message-types"
import type { ApprovalMode } from "../../../../contracts/permissions"
import type { SessionHistoryTurn } from "../../../../contracts/session-history"
import type { TodoItem } from "../../../../contracts/todos"
import { toast } from "../app/toast.store"
import { createAppStore } from "../create-store"

const CHAT_ACTIONS = {
  HISTORY_LOADED: "chat/historyLoaded",
  HISTORY_FAILED: "chat/historyFailed",
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

export function canManageQueuedPrompt(sessionId: string, item: QueuedPromptItem): boolean {
  return sessionId === QC_MOCK_SESSION_ID || Boolean(item.model && item.approvalMode)
}

type PromptSubmission = {
  sessionId: string
  prompt: string
  model: string
  workspacePath?: string
  approvalMode: ApprovalMode
}

export interface TurnState {
  requestId: string
  sessionId: string
  prompt: string
  assistantText: string
  isStreaming: boolean
  error: string | null
  warnings: string[]
  permission: { id: string; tool: string; action: string; resource: string; reason: string } | null
  question: { id: string; prompt: string; choices?: string[] } | null
  todos: TodoItem[]
  toolStatus: string | null
}

export type RetiredTurnExtras = Pick<TurnState, "warnings" | "todos">

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

export function resolveHistoryTurns(
  turns: readonly SessionHistoryTurn[],
  liveTurn: TurnState | undefined,
  pendingTurns: readonly TurnState[] = [],
): SessionHistoryTurn[] {
  const overlaid = new Set(pendingTurns.map((turn) => turn.requestId))
  if (liveTurn) overlaid.add(liveTurn.requestId)
  const visible = turns.filter((turn) => turn.requestId === null || !overlaid.has(turn.requestId))
  return visible.map(turn => turn.state === "running" ? { ...turn, state: "interrupted" } : turn)
}

function assertNever(value: never): never {
  throw new Error(`Unhandled harness event: ${JSON.stringify(value)}`)
}

interface ChatStoreState {
  history: Record<string, SessionHistoryTurn[]>
  turns: Record<string, TurnState>
  pendingHistoryTurns: Record<string, TurnState[]>
  // Warnings and todos are not stored in the DB, so a turn retired into history keeps them here by session and request
  retiredTurns: Record<string, Record<string, RetiredTurnExtras>>
  // Sessions whose first history load failed, so the page can offer a retry instead of an empty chat
  historyFailed: Record<string, true>
  queuedPrompts: Record<string, QueuedPromptItem[]>

  actions: {
    loadHistory: (sessionId: string | null) => Promise<SessionHistoryTurn[] | null>
    subscribeHarness: () => () => void
    sendPrompt: (params: PromptSubmission) => void
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

function newTurn({ sessionId, requestId, prompt }: Pick<TurnState, "sessionId" | "requestId" | "prompt">): TurnState {
  return {
    requestId, sessionId, prompt,
    assistantText: "",
    isStreaming: true,
    error: null,
    warnings: [],
    permission: null,
    question: null,
    todos: [],
    toolStatus: null,
  }
}

function replaceTurn(state: ChatStoreState, turn: TurnState) {
  const { sessionId } = turn
  const previous = state.turns[sessionId]
  const pending = state.pendingHistoryTurns[sessionId] ?? []
  return {
    turns: { ...state.turns, [sessionId]: turn },
    pendingHistoryTurns: previous && !previous.isStreaming && previous.requestId !== turn.requestId
      ? { ...state.pendingHistoryTurns, [sessionId]: [...pending, previous] }
      : state.pendingHistoryTurns,
  }
}

export const useChatStore = createAppStore<ChatStoreState>("ChatStore", (set, get) => {
  let activeHistorySessionId: string | null = null
  let selectionVersion = 0
  const loadTokens = new Map<string, symbol>()
  const deletedSessions = new Set<string>()
  // Reserve the session while a submission is in transit to the harness.
  const pendingSubmissions = new Map<string, string>()
  const cancelRequested = new Set<string>()

  const isBusy = (sessionId: string) =>
    pendingSubmissions.has(sessionId) || Boolean(get().turns[sessionId]?.isStreaming)

  const dispatchToHarness = (
    submission: PromptSubmission & { requestId: string },
    remaining?: QueuedPromptItem[],
  ) => {
    pendingSubmissions.set(submission.sessionId, submission.requestId)
    if (remaining) {
      set((state) => ({
        queuedPrompts: { ...state.queuedPrompts, [submission.sessionId]: remaining },
      }), false, CHAT_ACTIONS.QUEUE_SEND_NOW)
    }
    window.desktop.sendHarnessCommand({ type: HARNESS_COMMAND_TYPES.CHAT_SUBMIT, ...submission })
  }

  const cancelHarnessTurn = (sessionId: string) => {
    window.desktop.sendHarnessCommand({ type: HARNESS_COMMAND_TYPES.CHAT_CANCEL, sessionId })
  }

  const flushNextQueuedPrompt = (sessionId: string) => {
    if (deletedSessions.has(sessionId) || isBusy(sessionId)) return
    const [next, ...remaining] = get().queuedPrompts[sessionId] ?? []
    if (!next?.model || !next.approvalMode) return
    dispatchToHarness({
      requestId: next.requestId,
      sessionId,
      prompt: next.prompt,
      model: next.model,
      workspacePath: next.workspacePath,
      approvalMode: next.approvalMode,
    }, remaining)
  }

  const startQcPrompt = (item: QueuedPromptItem, message: string) => {
    set((state) => ({
      turns: {
        ...state.turns,
        [QC_MOCK_SESSION_ID]: {
          ...newTurn({ ...item, sessionId: QC_MOCK_SESSION_ID }),
          assistantText: `[QC Mock] ${message}: "${item.prompt}"`,
          question: state.turns[QC_MOCK_SESSION_ID]?.question ?? null,
          todos: state.turns[QC_MOCK_SESSION_ID]?.todos ?? [],
          toolStatus: "Simulating streaming response…",
        },
      },
    }), false, CHAT_ACTIONS.INIT_QC_MOCK)
  }

  const readHistory = async (sessionId: string): Promise<SessionHistoryTurn[] | null> => {
    if (
      sessionId === QC_MOCK_SESSION_ID ||
      deletedSessions.has(sessionId) ||
      typeof window === "undefined" ||
      typeof window.desktop?.listSessionHistory !== "function"
    ) {
      return null
    }
    // Background refreshes never change which session is selected
    const selectedAtStart = selectionVersion
    const token = Symbol()
    loadTokens.set(sessionId, token)
    let loaded: SessionHistoryTurn[]
    const isCurrent = () => selectionVersion === selectedAtStart && loadTokens.get(sessionId) === token
    try {
      loaded = await window.desktop.listSessionHistory(sessionId)
    } catch {
      // A refresh failure keeps the cached history, only a first load is marked failed
      if (isCurrent() && get().history[sessionId] === undefined) {
        set((state) => ({ historyFailed: { ...state.historyFailed, [sessionId]: true } }), false, CHAT_ACTIONS.HISTORY_FAILED)
      }
      return null
    }
    if (!isCurrent()) return null

    set((state) => {
      const saved = new Set(
        loaded.filter((turn) => turn.state && turn.state !== "running").map((turn) => turn.requestId),
      )
      const pending = state.pendingHistoryTurns[sessionId] ?? []
      const remaining = pending.filter((turn) => !saved.has(turn.requestId))
      const live = state.turns[sessionId]
      const retireLive = live && !live.isStreaming && saved.has(live.requestId)
      const { [sessionId]: _failed, ...historyFailed } = state.historyFailed
      const update: Partial<ChatStoreState> = { history: { ...state.history, [sessionId]: loaded }, historyFailed }
      const retired = [...pending.filter((turn) => saved.has(turn.requestId)), ...(retireLive ? [live] : [])]
        .filter((turn) => turn.warnings.length > 0 || turn.todos.length > 0)
      if (retired.length) {
        const extras = { ...state.retiredTurns[sessionId] }
        for (const turn of retired) extras[turn.requestId] = { warnings: turn.warnings, todos: turn.todos }
        update.retiredTurns = { ...state.retiredTurns, [sessionId]: extras }
      }
      if (retireLive) {
        update.turns = { ...state.turns }
        delete update.turns[sessionId]
      }
      if (remaining.length < pending.length) {
        update.pendingHistoryTurns = { ...state.pendingHistoryTurns }
        if (remaining.length) update.pendingHistoryTurns[sessionId] = remaining
        else delete update.pendingHistoryTurns[sessionId]
      }
      return update
    }, false, CHAT_ACTIONS.HISTORY_LOADED)
    return loaded
  }

  const handleEvent = (event: HarnessEvent) => {
    if (event.type === HARNESS_EVENT_TYPES.PONG || event.type === HARNESS_EVENT_TYPES.HARNESS_READY) return
    if ("sessionId" in event && (event.sessionId === QC_MOCK_SESSION_ID || deletedSessions.has(event.sessionId))) return
    switch (event.type) {
      case HARNESS_EVENT_TYPES.HARNESS_EXITED: {
        // A streaming turn shows the loss on itself, prompts queued behind a finished turn need a toast
        const current = get()
        const unseenLost = Object.entries(current.queuedPrompts)
          .filter(([sessionId]) => sessionId !== QC_MOCK_SESSION_ID && !current.turns[sessionId]?.isStreaming)
          .reduce((count, [, queue]) => count + queue.length, 0)
        const lost = unseenLost + pendingSubmissions.size
        pendingSubmissions.clear()
        cancelRequested.clear()
        if (lost > 0) toast.error(`The harness stopped. ${lost} waiting prompt(s) were lost.`)
        set(
          (state) => {
            const turns: Record<string, TurnState> = {}
            for (const [sessionId, turn] of Object.entries(state.turns)) {
              turns[sessionId] = sessionId !== QC_MOCK_SESSION_ID && turn.isStreaming
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
            const queuedPrompts: ChatStoreState["queuedPrompts"] = {}
            if (state.queuedPrompts[QC_MOCK_SESSION_ID]) {
              queuedPrompts[QC_MOCK_SESSION_ID] = state.queuedPrompts[QC_MOCK_SESSION_ID]
            }
            return { turns, queuedPrompts }
          },
          false,
          event.type,
        )
        return
      }
      case HARNESS_EVENT_TYPES.CHAT_QUEUED:
        // The harness may acknowledge our next submission while finishing its previous turn.
        if (pendingSubmissions.get(event.sessionId) === event.requestId) return
        set(
          (state) => {
            const queue = [...(state.queuedPrompts[event.sessionId] ?? [])]
            if (queue.some((item) => item.requestId === event.requestId)) return state
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
      case HARNESS_EVENT_TYPES.CHAT_STARTED: {
        const { sessionId, requestId } = event
        const wasSubmitted = pendingSubmissions.get(sessionId) === requestId
        if (wasSubmitted) pendingSubmissions.delete(sessionId)
        set(
          (state) => ({
            queuedPrompts: {
              ...state.queuedPrompts,
              [sessionId]: (state.queuedPrompts[sessionId] ?? []).filter((item) => item.requestId !== requestId),
            },
            ...replaceTurn(state, newTurn(event)),
          }),
          false,
          event.type,
        )
        if (wasSubmitted && cancelRequested.has(sessionId)) cancelHarnessTurn(sessionId)
        return
      }
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
              warnings: [...turn.warnings, event.message],
            })),
          }),
          false,
          event.type,
        )
        return
      case HARNESS_EVENT_TYPES.CHAT_COMPLETED:
      case HARNESS_EVENT_TYPES.CHAT_FAILED: {
        const { sessionId, requestId } = event
        const pendingRequest = pendingSubmissions.get(sessionId)
        const existing = get().turns[sessionId]
        const matchesActive = existing?.isStreaming && existing.requestId === requestId
        const matchesSubmission = pendingRequest === requestId
        const queue = get().queuedPrompts[sessionId] ?? []
        const wasQueued = queue.some((item) => item.requestId === requestId)
        if (matchesSubmission) pendingSubmissions.delete(sessionId)
        if (matchesActive || matchesSubmission) cancelRequested.delete(sessionId)

        set(
          (state) => {
            const queuedPrompts = { ...state.queuedPrompts, [sessionId]: queue.filter((item) => item.requestId !== requestId) }
            if (!matchesActive && (
              (existing?.isStreaming && existing.requestId !== requestId) ||
              (pendingRequest && !matchesSubmission && !wasQueued)
            )) return { queuedPrompts }

            const failed = event.type === HARNESS_EVENT_TYPES.CHAT_FAILED
            const turn = existing?.requestId === requestId ? existing : failed ? newTurn(event) : undefined
            if (!turn) return { queuedPrompts }
            return {
              queuedPrompts,
              ...replaceTurn(state, {
                ...turn,
                isStreaming: false,
                error: failed ? event.message : turn.error,
                permission: null,
                question: null,
                toolStatus: null,
              }),
            }
          },
          false,
          event.type,
        )
        void readHistory(sessionId)
        flushNextQueuedPrompt(sessionId)
        return
      }
      default:
        return assertNever(event)
    }
  }

  return {
    history: {},
    retiredTurns: {},
    historyFailed: {},
    turns: {},
    pendingHistoryTurns: {},
    queuedPrompts: {},

    actions: {
      loadHistory: (sessionId) => {
        if (activeHistorySessionId !== sessionId) {
          activeHistorySessionId = sessionId
          selectionVersion += 1
        }
        return sessionId === null ? Promise.resolve(null) : readHistory(sessionId)
      },

      subscribeHarness: () => window.desktop.subscribeHarnessEvents(handleEvent),

      sendPrompt: ({ sessionId, ...submission }) => {
        if (deletedSessions.has(sessionId)) return
        const item = { ...submission, requestId: crypto.randomUUID() }
        if (
          sessionId !== QC_MOCK_SESSION_ID &&
          !SubmitPromptCommandSchema.safeParse({ type: HARNESS_COMMAND_TYPES.CHAT_SUBMIT, sessionId, ...item }).success
        ) {
          toast.error("The prompt or its settings are invalid.")
          return
        }
        if (isBusy(sessionId)) {
          set(
            (state) => ({
              queuedPrompts: {
                ...state.queuedPrompts,
                [sessionId]: [...(state.queuedPrompts[sessionId] ?? []), item],
              },
            }),
            false,
            CHAT_ACTIONS.QUEUE_ADD,
          )
          return
        }
        if (sessionId === QC_MOCK_SESSION_ID) {
          startQcPrompt(item, "Started streaming response for")
          return
        }
        dispatchToHarness({ ...item, sessionId })
      },

      stopGeneration: (sessionId) => {
        const turn = get().turns[sessionId]
        if (sessionId === QC_MOCK_SESSION_ID) {
          if (!turn?.isStreaming) return
          set((state) => ({
            turns: {
              ...state.turns,
              [sessionId]: { ...turn, isStreaming: false, permission: null, question: null, toolStatus: null },
            },
          }), false, CHAT_ACTIONS.STOP_GENERATION)
          return
        }
        if (!isBusy(sessionId) || cancelRequested.has(sessionId)) return
        cancelRequested.add(sessionId)
        if (turn?.isStreaming) cancelHarnessTurn(sessionId)
      },

      sendQueuedPromptNow: (sessionId, requestId) => {
        const queue = get().queuedPrompts[sessionId] ?? []
        const target = queue.find((item) => item.requestId === requestId)
        if (!target) return
        const remaining = queue.filter((item) => item.requestId !== requestId)
        if (sessionId === QC_MOCK_SESSION_ID) {
          set((state) => ({
            queuedPrompts: { ...state.queuedPrompts, [sessionId]: remaining },
          }), false, CHAT_ACTIONS.QUEUE_SEND_NOW)
          startQcPrompt(target, "Sent queued message immediately")
          return
        }
        if (!target.model || !target.approvalMode) return
        set((state) => ({
          queuedPrompts: { ...state.queuedPrompts, [sessionId]: [target, ...remaining] },
        }), false, CHAT_ACTIONS.QUEUE_SEND_NOW)
        if (isBusy(sessionId)) get().actions.stopGeneration(sessionId)
        else flushNextQueuedPrompt(sessionId)
      },

      editQueuedPrompt: (sessionId, requestId, nextPrompt) => {
        const trimmed = nextPrompt.trim()
        if (!trimmed) return
        if (sessionId !== QC_MOCK_SESSION_ID && !SubmitPromptCommandSchema.shape.prompt.safeParse(trimmed).success) {
          toast.error("The prompt is too long.")
          return
        }
        set(
          (state) => ({
            queuedPrompts: {
              ...state.queuedPrompts,
              [sessionId]: (state.queuedPrompts[sessionId] ?? []).map((item) =>
                item.requestId === requestId && canManageQueuedPrompt(sessionId, item)
                  ? { ...item, prompt: trimmed } : item,
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
                (item) => item.requestId !== requestId || !canManageQueuedPrompt(sessionId, item),
              ),
            },
          }),
          false,
          CHAT_ACTIONS.QUEUE_DELETE,
        )
      },

      respondToPermission: (sessionId, requestId, permissionId, decision) => {
        if (sessionId !== QC_MOCK_SESSION_ID) {
          window.desktop.respondToPermission(permissionId, decision)
        }
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
                warnings: [],
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
        if (sessionId !== QC_MOCK_SESSION_ID) deletedSessions.add(sessionId)
        loadTokens.delete(sessionId)
        pendingSubmissions.delete(sessionId)
        cancelRequested.delete(sessionId)
        if (activeHistorySessionId === sessionId) {
          activeHistorySessionId = null
          selectionVersion += 1
        }
        if (sessionId !== QC_MOCK_SESSION_ID) {
          window.desktop.sendHarnessCommand({ type: HARNESS_COMMAND_TYPES.SESSION_DELETE, sessionId })
        }
        set(
          (state) => {
            const nextHistory = { ...state.history }
            const nextTurns = { ...state.turns }
            const nextPending = { ...state.pendingHistoryTurns }
            const nextQueue = { ...state.queuedPrompts }
            const { [sessionId]: _retired, ...retiredTurns } = state.retiredTurns
            const { [sessionId]: _failed, ...historyFailed } = state.historyFailed
            delete nextHistory[sessionId]
            delete nextTurns[sessionId]
            delete nextPending[sessionId]
            delete nextQueue[sessionId]
            return { history: nextHistory, retiredTurns, historyFailed, turns: nextTurns, pendingHistoryTurns: nextPending, queuedPrompts: nextQueue }
          },
          false,
          CHAT_ACTIONS.CLEAR_SESSION,
        )
      },

      reset: () => {
        activeHistorySessionId = null
        selectionVersion += 1
        loadTokens.clear()
        deletedSessions.clear()
        pendingSubmissions.clear()
        cancelRequested.clear()
        set({ history: {}, retiredTurns: {}, historyFailed: {}, turns: {}, pendingHistoryTurns: {}, queuedPrompts: {} }, false, CHAT_ACTIONS.RESET)
      },
    },
  }
})
