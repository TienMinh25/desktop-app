import { useState, type PointerEvent, type ReactNode } from "react"
import { SIDEBAR_LAYOUT } from "../../../constants"
import { SidebarFooter } from "../SidebarFooter/SidebarFooter"
import styles from "./Sidebar.module.scss"

interface SidebarProps {
  role?: string
  children: ReactNode
}

export function Sidebar({ role, children }: SidebarProps) {
  const [sidebarWidth, setSidebarWidth] = useState<number>(SIDEBAR_LAYOUT.DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = useState(false)

  const handleResizePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsResizing(true)
  }

  const handleResizePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isResizing) return
    const clampedWidth = Math.min(
      SIDEBAR_LAYOUT.MAX_WIDTH,
      Math.max(SIDEBAR_LAYOUT.MIN_WIDTH, event.clientX),
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
      <SidebarFooter role={role} />
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
