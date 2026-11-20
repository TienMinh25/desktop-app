import { IPC_CHANNELS } from "../../constants/ipcChannels"
import { toast, useDebugLogStore } from "../stores"
import { classifyAuthError, formatGeneralErrorMessage } from "./error-message"

interface IpcErrorEventDetail {
  channel: string
  message: string
}

const API_BADGE_STYLE = "background:#0284c7;color:#fff;padding:1px 5px;border-radius:3px;font-weight:600"
const IPC_BADGE_STYLE = "background:#7c3aed;color:#fff;padding:1px 5px;border-radius:3px;font-weight:600"

/**
 * Installs global IPC error & log listeners in the renderer:
 * 1. Listens for `ccodex:ipc-error` events emitted by the preload IPC wrapper
 *    and automatically triggers a top-right error toast for backend/network/5xx errors.
 * 2. Subscribes to forwarded Main process API/IPC logs (with distinct [API] vs [IPC] badges)
 *    for unified DevTools Console visibility.
 */
export function installDesktopBridgeInterceptor(): () => void {
  const cleanups: Array<() => void> = []

  if (typeof window === "undefined") {
    return () => {}
  }

  const handleIpcError = (event: Event) => {
    const customEvent = event as CustomEvent<IpcErrorEventDetail>
    const detail = customEvent.detail
    if (!detail) return

    if (detail.channel === IPC_CHANNELS.AUTH_GET_STATE) {
      return
    }

    useDebugLogStore.getState().appendLog({
      category: "ipc",
      level: "error",
      message: `[IPC !!] ${detail.channel}: ${detail.message}`,
    })

    if (detail.channel === IPC_CHANNELS.AUTH_LOGIN) {
      const classified = classifyAuthError(detail.message)
      if (classified.isGlobalToast) {
        toast.error(classified.message)
      }
      return
    }

    toast.error(formatGeneralErrorMessage(detail.message))
  }

  window.addEventListener("ccodex:ipc-error", handleIpcError)
  cleanups.push(() => window.removeEventListener("ccodex:ipc-error", handleIpcError))

  if (window.desktop && typeof window.desktop.subscribeLogEvents === "function") {
    const unsubLogs = window.desktop.subscribeLogEvents((entry) => {
      useDebugLogStore.getState().appendLog({
        category: entry.category,
        level: entry.level,
        message: entry.message,
        meta: entry.meta,
      })

      const badge = entry.category === "api" ? "API" : "IPC"
      const badgeStyle = entry.category === "api" ? API_BADGE_STYLE : IPC_BADGE_STYLE
      const logFn = entry.level === "error" ? console.error : console.info

      if (entry.meta !== undefined) {
        logFn(`%c${badge}%c ${entry.message}`, badgeStyle, "", entry.meta)
      } else {
        logFn(`%c${badge}%c ${entry.message}`, badgeStyle, "")
      }
    })
    cleanups.push(unsubLogs)
  }

  return () => {
    for (const cleanup of cleanups) {
      cleanup()
    }
  }
}
