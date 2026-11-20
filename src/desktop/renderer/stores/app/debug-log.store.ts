import { createAppStore, getAppEnvironment, isNonProdEnv } from "../create-store"

const DEBUG_LOG_ACTIONS = {
  APPEND: "debugLog/append",
  CLEAR: "debugLog/clear",
} as const

export { getAppEnvironment }

export type DebugLogCategory = "api" | "ipc"
export type DebugLogLevel = "info" | "error"

export interface DebugLogEntry {
  id: string
  timestamp: string
  category: DebugLogCategory
  level: DebugLogLevel
  message: string
  meta?: unknown
}

const MAX_LOGS = 150

export function isDebugLogViewerEnabled(): boolean {
  return isNonProdEnv()
}

interface DebugLogState {
  entries: DebugLogEntry[]
  appendLog: (entry: Omit<DebugLogEntry, "id" | "timestamp">) => void
  clearLogs: () => void
}

export const useDebugLogStore = createAppStore<DebugLogState>("DebugLogStore", (set) => ({
  entries: [],

  appendLog: (entry) => {
    if (!isNonProdEnv()) return
    const next: DebugLogEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date().toLocaleTimeString(),
    }
    set(
      (state) => ({
        entries: [next, ...state.entries].slice(0, MAX_LOGS),
      }),
      false,
      DEBUG_LOG_ACTIONS.APPEND,
    )
  },

  clearLogs: () => set({ entries: [] }, false, DEBUG_LOG_ACTIONS.CLEAR),
}))
