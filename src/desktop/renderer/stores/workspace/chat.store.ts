import type { HarnessEvent } from "../../../../contracts/events"
import { HARNESS_COMMAND_TYPES, HARNESS_EVENT_TYPES } from "../../../../contracts/message-types"
import type { ApprovalMode } from "../../../../contracts/permissions"
import type { SessionHistoryTurn } from "../../../../contracts/session-history"
import type { TodoItem } from "../../../../contracts/todos"
import { createAppStore } from "../create-store"

export const INTERRUPTED_TURN_MESSAGE = "This turn was interrupted."

const CHAT_ACTIONS = {
  HISTORY_LOADED: "chat/historyLoaded",
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
  warnings: string[]
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

function normalizeHistoryTurns(
  turns: readonly SessionHistoryTurn[],
  liveTurn: TurnState | undefined,
): SessionHistoryTurn[] {
  return turns.map((turn) =>
    turn.state === "running" && (!liveTurn || turn.requestId === null || turn.requestId !== liveTurn.requestId)
      ? { ...turn, state: "interrupted" }
      : turn,
  )
}

export function resolveHistoryTurns(
  turns: readonly SessionHistoryTurn[],
  liveTurn: TurnState | undefined,
): SessionHistoryTurn[] {
  // Hide the DB row overlaid by the active live turn to prevent duplicate rendering
  return normalizeHistoryTurns(turns, liveTurn).filter(
    (turn) => !(liveTurn && turn.requestId !== null && turn.requestId === liveTurn.requestId),
  )
}

function assertNever(value: never): never {
  throw new Error(`Unhandled harness event: ${JSON.stringify(value)}`)
}

interface ChatStoreState {
  history: Record<string, SessionHistoryTurn[]>
  turns: Record<string, TurnState>
  queuedPrompts: Record<string, Array<{ requestId: string; prompt: string }>>

  loadHistory: (sessionId: string) => Promise<SessionHistoryTurn[] | null>
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

export const useChatStore = createAppStore<ChatStoreState>("ChatStore", (set, get) => {
  let activeHistorySessionId: string | null = null
  const loadTokens = new Map<string, number>()

  const loadHistory = async (sessionId: string): Promise<SessionHistoryTurn[] | null> => {
    activeHistorySessionId = sessionId
    const token = (loadTokens.get(sessionId) ?? 0) + 1
    loadTokens.set(sessionId, token)
    if (typeof window === "undefined" || typeof window.desktop?.listSessionHistory !== "function") {
      return null
    }
    let loaded: SessionHistoryTurn[]
    try {
      loaded = await window.desktop.listSessionHistory(sessionId)
    } catch {
      return null
    }
    // Drop stale responses after switching sessions or starting a newer load
    if (activeHistorySessionId !== sessionId || loadTokens.get(sessionId) !== token) {
      return null
    }
    let normalized: SessionHistoryTurn[] = loaded
    set(
      (state) => {
        const liveTurn = state.turns[sessionId]
        normalized = normalizeHistoryTurns(loaded, liveTurn)
        const shouldDropLive = Boolean(
          liveTurn &&
            !liveTurn.isStreaming &&
            normalized.some((turn) => turn.requestId === liveTurn.requestId && turn.state !== "running"),
        )
        if (!shouldDropLive) {
          return { history: { ...state.history, [sessionId]: normalized } }
        }
        const nextTurns = { ...state.turns }
        delete nextTurns[sessionId]
        return {
          history: { ...state.history, [sessionId]: normalized },
          turns: nextTurns,
        }
      },
      false,
      CHAT_ACTIONS.HISTORY_LOADED,
    )
    return normalized
  }

  const reloadTurnHistory = async (sessionId: string, requestId: string): Promise<void> => {
    if (typeof window === "undefined" || typeof window.desktop?.listSessionHistory !== "function") {
      return
    }
    const token = (loadTokens.get(sessionId) ?? 0) + 1
    loadTokens.set(sessionId, token)
    let loaded: SessionHistoryTurn[]
    try {
      loaded = await window.desktop.listSessionHistory(sessionId)
    } catch {
      return
    }
    if (loadTokens.get(sessionId) !== token) return
    if (activeHistorySessionId !== null && activeHistorySessionId !== sessionId) return
    set(
      (state) => {
        const liveTurn = state.turns[sessionId]
        const hasPersistedTurn = loaded.some((turn) => turn.requestId === requestId)
        // Keep the live overlay when the DB does not contain the finished request yet
        const removeOverlay = Boolean(liveTurn && liveTurn.requestId === requestId && hasPersistedTurn)
        const remainingLive = removeOverlay ? undefined : liveTurn
        const normalized = normalizeHistoryTurns(loaded, remainingLive)
        const nextHistory = { ...state.history, [sessionId]: normalized }
        if (!removeOverlay) return { history: nextHistory }
        const nextTurns = { ...state.turns }
        delete nextTurns[sessionId]
        return { history: nextHistory, turns: nextTurns }
      },
      false,
      CHAT_ACTIONS.HISTORY_LOADED,
    )
  }

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
                warnings: [],
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
              warnings: [...turn.warnings, event.message],
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
        void reloadTurnHistory(event.sessionId, event.requestId)
        return
      case HARNESS_EVENT_TYPES.CHAT_FAILED: {
        const currentTurn = get().turns[event.sessionId]
        const ignoreFailureForActiveTurn = Boolean(
          currentTurn?.isStreaming && currentTurn.requestId !== event.requestId,
        )
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
              warnings: [],
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
        if (!ignoreFailureForActiveTurn) void reloadTurnHistory(event.sessionId, event.requestId)
        return
      }
      default:
        return assertNever(event)
    }
  }

  return {
    history: {},
    turns: {},
    queuedPrompts: {},

    loadHistory,

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
      // Invalidate any in-flight history load for the deleted session
      loadTokens.set(sessionId, (loadTokens.get(sessionId) ?? 0) + 1)
      if (activeHistorySessionId === sessionId) activeHistorySessionId = null
      window.desktop.sendHarnessCommand({
        type: HARNESS_COMMAND_TYPES.SESSION_DELETE,
        sessionId,
      })
      set(
        (state) => {
          const nextHistory = { ...state.history }
          const nextTurns = { ...state.turns }
          const nextQueue = { ...state.queuedPrompts }
          delete nextHistory[sessionId]
          delete nextTurns[sessionId]
          delete nextQueue[sessionId]
          return { history: nextHistory, turns: nextTurns, queuedPrompts: nextQueue }
        },
        false,
        CHAT_ACTIONS.CLEAR_SESSION,
      )
    },

    reset: () => {
      activeHistorySessionId = null
      loadTokens.clear()
      set({ history: {}, turns: {}, queuedPrompts: {} }, false, CHAT_ACTIONS.RESET)
    },
  }
})
