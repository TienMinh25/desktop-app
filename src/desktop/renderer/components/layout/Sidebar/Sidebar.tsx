import { useState, type PointerEvent, type ReactNode } from "react"
import type { Theme } from "../../../theme/ThemeContext"
import { SidebarFooter } from "../SidebarFooter/SidebarFooter"
import styles from "./Sidebar.module.scss"

interface SidebarProps {
  username: string
  role?: string
  onSignOut: () => void
  onThemeChangeToast?: (theme: Theme) => void
  children: ReactNode
}

const DEFAULT_SIDEBAR_WIDTH = 250
const MIN_SIDEBAR_WIDTH = 210
const MAX_SIDEBAR_WIDTH = 420

export function Sidebar({
  username,
  role,
  onSignOut,
  onThemeChangeToast,
  children,
}: SidebarProps) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [isResizing, setIsResizing] = useState(false)

  const handleResizePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsResizing(true)
  }

  const handleResizePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isResizing) return
    const clampedWidth = Math.min(
      MAX_SIDEBAR_WIDTH,
      Math.max(MIN_SIDEBAR_WIDTH, event.clientX),
    )
    setSidebarWidth(clampedWidth)
  }

  const handleResizePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (!isResizing) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setIsResizing(false)
  }

  return (
    <aside className={styles.sidebar} style={{ width: `${sidebarWidth}px` }}>
      <div className={styles.sidebarBody}>{children}</div>
      <SidebarFooter
        username={username}
        role={role}
        onSignOut={onSignOut}
        onThemeChangeToast={onThemeChangeToast}
      />
      <div
        className={`${styles.resizeHandle} ${isResizing ? styles.isResizing : ""}`}
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerEnd}
        onPointerCancel={handleResizePointerEnd}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
      />
    </aside>
  )
}