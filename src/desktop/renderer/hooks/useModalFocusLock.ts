import { useEffect, type RefObject } from "react"

const FOCUSABLE_SELECTOR = [
  "button:not(:disabled)",
  "[href]",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"])',
].join(", ")

interface UseModalFocusLockOptions {
  enabled?: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
  onEscape?: () => void
}

/**
 * Keeps Tab / Shift+Tab keyboard focus locked inside a modal dialog while it is open,
 * and optionally closes the modal when Escape is pressed.
 */
export function useModalFocusLock(
  modalRef: RefObject<HTMLElement | null>,
  options: UseModalFocusLockOptions = {},
): void {
  const { enabled = true, initialFocusRef, onEscape } = options

  useEffect(() => {
    if (!enabled) return
    const container = modalRef.current
    if (!container) return

    const getFocusableElements = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.getClientRects().length > 0,
      )

    const initialTarget = initialFocusRef?.current ?? getFocusableElements()[0]
    initialTarget?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onEscape) {
        event.preventDefault()
        onEscape()
        return
      }
      if (event.key !== "Tab") return

      const focusables = getFocusableElements()
      if (focusables.length === 0) {
        event.preventDefault()
        return
      }

      const first = focusables[0]!
      const last = focusables[focusables.length - 1]!
      const active = document.activeElement as HTMLElement | null

      if (!active || !container.contains(active)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
        return
      }

      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown, true)
    return () => document.removeEventListener("keydown", handleKeyDown, true)
  }, [enabled, modalRef, initialFocusRef, onEscape])
}
