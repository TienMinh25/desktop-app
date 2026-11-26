import type { HarnessEvent } from "../../../../contracts/events"
import { HARNESS_COMMAND_TYPES, HARNESS_EVENT_TYPES } from "../../../../contracts/message-types"
import type { ApprovalMode } from "../../../../contracts/permissions"
import type { SessionHistoryTurn } from "../../../../contracts/session-history"
import type { TodoItem } from "../../../../contracts/todos"
import { createAppStore } from "../create-store"

export const INTERRUPTED_TURN_MESSAGE = "This turn was interrupted."

const CHAT_ACTIONS = {
  HISTORY_LOADED: "chat/historyLoaded",
  HISTORY_FAILED: "chat/historyFailed",
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
  queuedPrompts: Record<string, Array<{ requestId: string; prompt: string }>>

  loadHistory: (sessionId: string | null) => Promise<SessionHistoryTurn[] | null>
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

  const readHistory = async (sessionId: string): Promise<SessionHistoryTurn[] | null> => {
    if (
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
    if ("sessionId" in event && deletedSessions.has(event.sessionId)) return
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
            ...replaceTurn(state, {
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
            }),
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
              permission: null,
              question: null,
              toolStatus: null,
            })),
          }),
          false,
          event.type,
        )
        void readHistory(event.sessionId)
        return
      case HARNESS_EVENT_TYPES.CHAT_FAILED: {
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
              ...replaceTurn(state, {
                ...turn,
                isStreaming: false,
                error: event.message,
                permission: null,
                question: null,
                toolStatus: null,
              }),
            }
          },
          false,
          event.type,
        )
        void readHistory(event.sessionId)
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

    loadHistory: (sessionId) => {
      if (activeHistorySessionId !== sessionId) {
        activeHistorySessionId = sessionId
        selectionVersion += 1
      }
      return sessionId === null ? Promise.resolve(null) : readHistory(sessionId)
    },

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
      deletedSessions.add(sessionId)
      loadTokens.delete(sessionId)
      if (activeHistorySessionId === sessionId) {
        activeHistorySessionId = null
        selectionVersion += 1
      }
      window.desktop.sendHarnessCommand({
        type: HARNESS_COMMAND_TYPES.SESSION_DELETE,
        sessionId,
      })
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
      set({ history: {}, retiredTurns: {}, historyFailed: {}, turns: {}, pendingHistoryTurns: {}, queuedPrompts: {} }, false, CHAT_ACTIONS.RESET)
    },
  }
})
