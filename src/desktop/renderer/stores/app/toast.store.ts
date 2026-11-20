import { createAppStore } from "../create-store"

const TOAST_ACTIONS = {
  SHOW: "toast/show",
  AUTO_DISMISS: "toast/autoDismiss",
  DISMISS: "toast/dismiss",
} as const

export type ToastType = "info" | "success" | "warning" | "error"

export interface ToastItem {
  id: string
  message: string
  type: ToastType
  durationMs: number
}

const DEFAULT_DURATIONS: Record<ToastType, number> = {
  info: 2800,
  success: 3000,
  warning: 4000,
  error: 5000,
}

interface ToastState {
  activeToast: ToastItem | null
  showToast: (message: string, type?: ToastType, durationMs?: number) => void
  dismissToast: () => void
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useToastStore = createAppStore<ToastState>("ToastStore", (set) => ({
  activeToast: null,

  showToast: (message, type = "info", durationMs) => {
    if (toastTimer) {
      clearTimeout(toastTimer)
      toastTimer = null
    }
    const resolvedDuration = durationMs ?? DEFAULT_DURATIONS[type]
    const id = crypto.randomUUID()
    set({ activeToast: { id, message, type, durationMs: resolvedDuration } }, false, TOAST_ACTIONS.SHOW)

    toastTimer = setTimeout(() => {
      set(
        (state) => (state.activeToast?.id === id ? { activeToast: null } : state),
        false,
        TOAST_ACTIONS.AUTO_DISMISS,
      )
      toastTimer = null
    }, resolvedDuration)
  },

  dismissToast: () => {
    if (toastTimer) {
      clearTimeout(toastTimer)
      toastTimer = null
    }
    set({ activeToast: null }, false, TOAST_ACTIONS.DISMISS)
  },
}))

/** Helper callable inside or outside React components. */
export const toast = {
  info: (message: string, durationMs?: number) =>
    useToastStore.getState().showToast(message, "info", durationMs),
  success: (message: string, durationMs?: number) =>
    useToastStore.getState().showToast(message, "success", durationMs),
  warning: (message: string, durationMs?: number) =>
    useToastStore.getState().showToast(message, "warning", durationMs),
  error: (message: string, durationMs?: number) =>
    useToastStore.getState().showToast(message, "error", durationMs),
}
