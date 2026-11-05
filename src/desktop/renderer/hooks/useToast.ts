import { useCallback, useRef, useState } from "react"
import { APP_CONFIG } from "../constants"

export function useToast(durationMs: number = APP_CONFIG.TOAST_DURATION_MS) {
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback(
    (message: string) => {
      setToastMessage(message)
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current)
      }
      toastTimerRef.current = setTimeout(() => {
        setToastMessage(null)
      }, durationMs)
    },
    [durationMs],
  )

  return { toastMessage, showToast }
}