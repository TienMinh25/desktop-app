export type ToastType = "info" | "success" | "warning" | "error"

export interface ToastItem {
  id: string
  message: string
  type: ToastType
  durationMs: number
}

type ToastListener = (toast: ToastItem) => void

const listeners = new Set<ToastListener>()

const DEFAULT_DURATIONS: Record<ToastType, number> = {
  info: 2800,
  success: 3000,
  warning: 4000,
  error: 5000,
}

export function publishToast(
  message: string,
  type: ToastType = "info",
  durationMs?: number,
): void {
  const item: ToastItem = {
    id: crypto.randomUUID(),
    message,
    type,
    durationMs: durationMs ?? DEFAULT_DURATIONS[type],
  }
  for (const listener of listeners) {
    listener(item)
  }
}

export function subscribeToasts(listener: ToastListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const toast = {
  info: (message: string, durationMs?: number) => publishToast(message, "info", durationMs),
  success: (message: string, durationMs?: number) => publishToast(message, "success", durationMs),
  warning: (message: string, durationMs?: number) => publishToast(message, "warning", durationMs),
  error: (message: string, durationMs?: number) => publishToast(message, "error", durationMs),
}
