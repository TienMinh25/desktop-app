import { useEffect, useRef, useState } from "react"
import { APP_CONFIG } from "../../../constants"
import { useClickOutside } from "../../../hooks/useClickOutside"
import { toast, useThemeStore } from "../../../stores"
import styles from "./TitleBar.module.scss"

interface TitleBarProps {
  title?: string
}

export function TitleBar({ title = APP_CONFIG.APP_TITLE }: TitleBarProps) {
  const theme = useThemeStore((state) => state.theme)
  const isLight = theme === "light"
  const isMac =
    (window.desktop?.platform ?? "") === "darwin" ||
    (typeof navigator !== "undefined" &&
      (/Mac|iPhone|iPod|iPad/i.test(navigator.userAgent) ||
        navigator.platform?.toUpperCase().includes("MAC")))
  const [panelOpen, setPanelOpen] = useState(false)
  const [updateState, setUpdateState] = useState<"idle" | "starting" | "started">("idle")
  const [updateVersion, setUpdateVersion] = useState<string>(APP_CONFIG.UPDATE_VERSION)
  const wrapRef = useRef<HTMLDivElement>(null)

  useClickOutside(wrapRef, () => setPanelOpen(false))

  useEffect(() => {
    if (!window.desktop?.subscribeUpdaterStatus) return
    return window.desktop.subscribeUpdaterStatus((state) => {
      if (state.status === "available") {
        setUpdateVersion(state.version)
      } else if (state.status === "downloading") {
        setUpdateState("starting")
      } else if (state.status === "downloaded") {
        setUpdateVersion(state.version)
        setUpdateState("started")
        toast.success(`Version ${state.version} downloaded. Ready to restart and install.`)
      } else if (state.status === "error") {
        setUpdateState("idle")
        toast.error(`Update check failed: ${state.message}`)
      }
    })
  }, [])

  const handleStartUpdate = async () => {
    if (updateState === "started") {
      window.desktop?.installDownloadedUpdate?.()
      return
    }
    setUpdateState("starting")
    setPanelOpen(false)
    toast.info("Update started. C-CodeX will restart after installation.")
    try {
      if (window.desktop?.startUpdateDownload) {
        await window.desktop.startUpdateDownload()
      } else {
        setTimeout(() => {
          setUpdateState("started")
        }, 500)
      }
    } catch {
      setTimeout(() => {
        setUpdateState("started")
      }, 500)
    }
  }

  const notificationBellNode = (
    <div
      className={`${styles.notificationWrap} ${isMac ? styles.notificationWrapRight : ""}`}
      ref={wrapRef}
    >
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
                {APP_CONFIG.APP_TITLE} {updateVersion} is ready. Install the latest app updates now.
              </p>
              <span className={styles.updateVersion}>
                Version {updateVersion} · {APP_CONFIG.UPDATE_SIZE}
              </span>
            </div>
          </div>
          <button
            className={styles.updateNowButton}
            type="button"
            disabled={updateState === "starting"}
            onClick={() => void handleStartUpdate()}
          >
            {updateState === "idle"
              ? "Update now"
              : updateState === "starting"
                ? "Starting update…"
                : "Restart & install"}
          </button>
        </div>
      )}
    </div>
  )

  const macControls = (
    <div className={styles.macTrafficLights} aria-label="Window controls">
      <button
        className={`${styles.macDot} ${styles.macDotClose}`}
        type="button"
        title="Close"
        aria-label="Close"
        onClick={() => window.desktop?.closeWindow()}
      >
        <svg className={styles.macDotIcon} viewBox="0 0 12 12" fill="none">
          <path d="M3 3l6 6m0-6l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
      <button
        className={`${styles.macDot} ${styles.macDotMinimize}`}
        type="button"
        title="Minimize"
        aria-label="Minimize"
        onClick={() => window.desktop?.minimizeWindow()}
      >
        <svg className={styles.macDotIcon} viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
      <button
        className={`${styles.macDot} ${styles.macDotMaximize}`}
        type="button"
        title="Maximize"
        aria-label="Maximize"
        onClick={() => window.desktop?.maximizeWindow()}
      >
        <svg className={styles.macDotIcon} viewBox="0 0 12 12" fill="none">
          <path
            d="M3.5 3.5l5 5m0-5v5h-5"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )

  const winControls = (
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
  )

  return (
    <header className={`${styles.osBar} ${isMac ? styles.macBar : styles.winBar} ${isLight ? styles.lightBar : ""}`}>
      {isMac ? macControls : notificationBellNode}

      <span className={styles.osBarTitle}>{title}</span>

      {isMac ? notificationBellNode : winControls}
    </header>
  )
}
