declare const __APP_RENDERER_ENV__:
  | {
      APP_ENV?: string
      ENABLE_API_LOG?: string
      ENABLE_IPC_LOG?: string
    }
  | undefined

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
let entries: DebugLogEntry[] = []
const listeners = new Set<() => void>()

export function getAppEnvironment(): "sit" | "uat" | "prod" {
  const buildEnv = typeof __APP_RENDERER_ENV__ !== "undefined" ? __APP_RENDERER_ENV__ : undefined
  const raw = (buildEnv?.APP_ENV ?? "sit").toLowerCase()
  if (raw === "prod" || raw === "production") return "prod"
  if (raw === "uat") return "uat"
  return "sit"
}

export function isDebugLogViewerEnabled(): boolean {
  return getAppEnvironment() !== "prod"
}

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function appendDebugLog(entry: Omit<DebugLogEntry, "id" | "timestamp">): void {
  if (!isDebugLogViewerEnabled()) return
  const next: DebugLogEntry = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: new Date().toLocaleTimeString(),
  }
  entries = [next, ...entries].slice(0, MAX_LOGS)
  notify()
}

export function clearDebugLogs(): void {
  entries = []
  notify()
}

export function getDebugLogs(): readonly DebugLogEntry[] {
  return entries
}

export function subscribeDebugLogs(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
