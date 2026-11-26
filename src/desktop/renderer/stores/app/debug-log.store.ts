import { DEBUG_LOG_CONFIG } from "../../constants"
import { createAppStore, getAppEnvironment, isNonProdEnv } from "../create-store"

const DEBUG_LOG_ACTIONS = {
  APPEND: "debugLog/append",
  CLEAR: "debugLog/clear",
  TOGGLE_CAPTURING: "debugLog/toggleCapturing",
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

function appendBoundedEntries(entries: DebugLogEntry[], next: DebugLogEntry): DebugLogEntry[] {
  let categoryCount = 1
  const result: DebugLogEntry[] = [next]
  for (const item of entries) {
    if (item.category === next.category) {
      if (categoryCount >= DEBUG_LOG_CONFIG.MAX_LOGS_PER_CATEGORY) continue
      categoryCount += 1
    }
    result.push(item)
  }
  return result
}

export function isDebugLogViewerEnabled(): boolean {
  return isNonProdEnv()
}

interface DebugLogState {
  entries: DebugLogEntry[]
  isCapturing: boolean
  actions: {
    appendLog: (entry: Omit<DebugLogEntry, "id" | "timestamp">) => void
    toggleCapturing: () => void
    clearLogs: () => void
  }
}

export const useDebugLogStore = createAppStore<DebugLogState>("DebugLogStore", (set, get) => ({
  entries: [],
  isCapturing: true,

  actions: {
    appendLog: (entry) => {
      if (!isNonProdEnv() || !get().isCapturing) return
      const next: DebugLogEntry = {
        ...entry,
        id: crypto.randomUUID(),
        timestamp: new Date().toLocaleTimeString(),
      }
      set(
        (state) => ({
          entries: appendBoundedEntries(state.entries, next),
        }),
        false,
        DEBUG_LOG_ACTIONS.APPEND,
      )
    },

    toggleCapturing: () =>
      set((state) => ({ isCapturing: !state.isCapturing }), false, DEBUG_LOG_ACTIONS.TOGGLE_CAPTURING),

    clearLogs: () => set({ entries: [] }, false, DEBUG_LOG_ACTIONS.CLEAR),
  },
}))
