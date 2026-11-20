import { useEffect, useRef, useState } from "react"
import { useModalFocusLock } from "../../../hooks/useModalFocusLock"
import {
  clearDebugLogs,
  getAppEnvironment,
  getDebugLogs,
  isDebugLogViewerEnabled,
  subscribeDebugLogs,
  type DebugLogEntry,
} from "../../../utils/log-store"
import styles from "./DebugLogModal.module.scss"

type FilterKind = "all" | "api" | "ipc" | "error"

function DebugLogDialog({
  logs,
  envLabel,
  onClose,
}: {
  logs: readonly DebugLogEntry[]
  envLabel: string
  onClose: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const [filter, setFilter] = useState<FilterKind>("all")

  useModalFocusLock(cardRef, { initialFocusRef: closeBtnRef, onEscape: onClose })

  const filtered = logs.filter((entry) => {
    if (filter === "api") return entry.category === "api"
    if (filter === "ipc") return entry.category === "ipc"
    if (filter === "error") return entry.level === "error"
    return true
  })

  const handleCopy = () => {
    const text = filtered
      .map((item) => {
        const metaStr = item.meta !== undefined ? ` ${JSON.stringify(item.meta)}` : ""
        return `${item.timestamp} [${item.category.toUpperCase()}] ${item.message}${metaStr}`
      })
      .join("\n")
    void navigator.clipboard?.writeText(text)
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={cardRef}
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="debugLogTitle"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <span className={styles.envTag}>{envLabel}</span>
            <h2 id="debugLogTitle">Runtime Logs (API &amp; IPC)</h2>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.actionBtn} onClick={handleCopy}>
              Copy
            </button>
            <button type="button" className={styles.actionBtn} onClick={clearDebugLogs}>
              Clear
            </button>
            <button ref={closeBtnRef} type="button" className={styles.actionBtn} onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className={styles.filterBar}>
          {(["all", "api", "ipc", "error"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className={`${styles.filterBtn} ${filter === kind ? styles.active : ""}`}
              onClick={() => setFilter(kind)}
            >
              {kind === "all"
                ? `All (${logs.length})`
                : kind === "api"
                  ? "API"
                  : kind === "ipc"
                    ? "IPC"
                    : `Errors (${logs.filter((l) => l.level === "error").length})`}
            </button>
          ))}
        </div>

        <div className={styles.logList}>
          {filtered.length === 0 ? (
            <div className={styles.emptyState}>No logs recorded yet.</div>
          ) : (
            filtered.map((entry) => (
              <div
                key={entry.id}
                className={`${styles.logItem} ${entry.level === "error" ? styles.logError : ""}`}
              >
                <div className={styles.logTop}>
                  <span className={styles.time}>{entry.timestamp}</span>
                  <span className={entry.category === "api" ? styles.badgeApi : styles.badgeIpc}>
                    {entry.category.toUpperCase()}
                  </span>
                  <span className={styles.msg}>{entry.message}</span>
                </div>
                {entry.meta !== undefined && entry.meta !== "" && (
                  <pre className={styles.meta}>{JSON.stringify(entry.meta, null, 2)}</pre>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Floating log trigger & viewer modal, active only on non-prod environments (SIT / UAT).
 */
export function DebugLogViewer() {
  const enabled = isDebugLogViewerEnabled()
  const envLabel = getAppEnvironment().toUpperCase()
  const [isOpen, setIsOpen] = useState(false)
  const [logs, setLogs] = useState<readonly DebugLogEntry[]>(() => getDebugLogs())

  useEffect(() => {
    if (!enabled) return
    return subscribeDebugLogs(() => {
      setLogs(getDebugLogs())
    })
  }, [enabled])

  if (!enabled) return null

  const errorCount = logs.filter((entry) => entry.level === "error").length

  return (
    <>
      <button
        type="button"
        className={styles.triggerBtn}
        onClick={() => setIsOpen(true)}
        title="Open runtime API & IPC logs"
      >
        <span className={styles.envTag}>{envLabel}</span>
        <span>Logs ({logs.length})</span>
        {errorCount > 0 && <span className={styles.errorBadge}>{errorCount}</span>}
      </button>

      {isOpen && (
        <DebugLogDialog
          logs={logs}
          envLabel={envLabel}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  )
}
