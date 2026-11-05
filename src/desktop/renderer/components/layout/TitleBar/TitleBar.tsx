import { useRef, useState } from "react"
import { APP_CONFIG } from "../../../constants"
import { useClickOutside } from "../../../hooks/useClickOutside"
import { useTheme } from "../../../theme/ThemeContext"
import styles from "./TitleBar.module.scss"

interface TitleBarProps {
  title?: string
  onShowToast: (message: string) => void
}

export function TitleBar({ title = APP_CONFIG.APP_TITLE, onShowToast }: TitleBarProps) {
  const { theme } = useTheme()
  const isLight = theme === "light"
  const [panelOpen, setPanelOpen] = useState(false)
  const [updateState, setUpdateState] = useState<"idle" | "starting" | "started">("idle")
  const wrapRef = useRef<HTMLDivElement>(null)

  useClickOutside(wrapRef, () => setPanelOpen(false))

  const handleStartUpdate = () => {
    setUpdateState("starting")
    setPanelOpen(false)
    onShowToast("Update started. C-CodeX will restart after installation.")
    setTimeout(() => {
      setUpdateState("started")
    }, 500)
  }

  return (
    <header className={`${styles.osBar} ${isLight ? styles.lightBar : ""}`}>
      <div className={styles.notificationWrap} ref={wrapRef}>
        <button
          className={styles.notificationBell}
          type="button"
          aria-label="App notifications, one unread"
          aria-expanded={panelOpen}
          title="App notifications"
          onClick={() => setPanelOpen((prev) => !prev)}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <path
              d="M12.5 6.5a4.5 4.5 0 0 0-9 0c0 5-2 5-2 6.2h13c0-1.2-2-1.2-2-6.2ZM6.3 14a1.8 1.8 0 0 0 3.4 0"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {updateState === "idle" && <span className={styles.notificationDot} />}
        </button>

        {panelOpen && (
          <div
            className={`${styles.notificationPanel} ${isLight ? styles.lightPanel : ""}`}
            role="dialog"
            aria-label="App notifications"
          >
            <div className={styles.panelHead}>
              <span>App updates</span>
              <span className={styles.unreadLabel}>1 new</span>
            </div>
            <div className={styles.updateNotice}>
              <span className={styles.updateIcon}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M8 2v8m0 0 3-3m-3 3L5 7M3 11v2h10v-2"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <div>
                <strong>New version available</strong>
                <p>
                  {APP_CONFIG.APP_TITLE} {APP_CONFIG.UPDATE_VERSION} is ready. Install the latest
                  app updates now.
                </p>
                <span className={styles.updateVersion}>
                  Version {APP_CONFIG.UPDATE_VERSION} · {APP_CONFIG.UPDATE_SIZE}
                </span>
              </div>
            </div>
            <button
              className={styles.updateNowButton}
              type="button"
              disabled={updateState !== "idle"}
              onClick={handleStartUpdate}
            >
              {updateState === "idle"
                ? "Update now"
                : updateState === "starting"
                  ? "Starting update…"
                  : "Update started"}
            </button>
          </div>
        )}
      </div>

      <span className={styles.osBarTitle}>{title}</span>

      <div className={styles.windowControls} aria-label="Window controls">
        <button
          className={styles.windowControl}
          type="button"
          title="Minimize"
          aria-label="Minimize"
          onClick={() => window.desktop?.minimizeWindow()}
        >
          <svg viewBox="0 0 10 10" fill="none">
            <path d="M1 7.5h8" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        </button>
        <button
          className={styles.windowControl}
          type="button"
          title="Maximize"
          aria-label="Maximize"
          onClick={() => window.desktop?.maximizeWindow()}
        >
          <svg viewBox="0 0 10 10" fill="none">
            <rect x="1.5" y="1.5" width="7" height="7" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        </button>
        <button
          className={`${styles.windowControl} ${styles.close}`}
          type="button"
          title="Close"
          aria-label="Close"
          onClick={() => window.desktop?.closeWindow()}
        >
          <svg viewBox="0 0 10 10" fill="none">
            <path d="m2 2 6 6m0-6L2 8" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        </button>
      </div>
    </header>
  )
}