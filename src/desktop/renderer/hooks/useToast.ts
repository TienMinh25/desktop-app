import { useCallback, useEffect, useRef, useState } from "react"
import { publishToast, subscribeToasts, type ToastItem, type ToastType } from "../utils/toast"

export function useToast() {
  const [activeToast, setActiveToast] = useState<ToastItem | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current)
      toastTimerRef.current = null
    }
    setActiveToast(null)
  }, [])

  useEffect(() => {
    return subscribeToasts((item) => {
      setActiveToast(item)
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current)
      }
      toastTimerRef.current = setTimeout(() => {
        setActiveToast(null)
        toastTimerRef.current = null
      }, item.durationMs)
    })
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current)
      }
    }
  }, [])

  const showToast = useCallback((message: string, type: ToastType = "info", durationMs?: number) => {
    publishToast(message, type, durationMs)
  }, [])

  return {
    activeToast,
    toastMessage: activeToast?.message ?? null,
    showToast,
    dismissToast,
  }
}
