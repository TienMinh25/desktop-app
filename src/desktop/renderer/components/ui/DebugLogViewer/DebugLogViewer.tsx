import { useEffect, useRef, useState } from "react"
import { DEBUG_LOG_CONFIG } from "../../../constants"
import {
  getAppEnvironment,
  isDebugLogViewerEnabled,
  useDebugLogStore,
  type DebugLogEntry,
} from "../../../stores"
import {
  buildLocalStoreSnapshots,
  formatLogEntryText,
  isImportantLog,
  type StoreSnapshotItem,
} from "../../../utils/debug-log"
import styles from "./DebugLogViewer.module.scss"

type FilterKind = "important" | "all" | "api" | "ipc" | "error" | "stores"

const DEBUG_SYNC_CHANNEL = DEBUG_LOG_CONFIG.SYNC_CHANNEL

function StoreStateInspector({ snapshots }: { snapshots: StoreSnapshotItem[] }) {
  const [expandedStore, setExpandedStore] = useState<string | null>("AuthStore")

  return (
    <>
      {snapshots.map((store) => {
        const isExpanded = expandedStore === store.name
        return (
          <div key={store.name} className={styles.storeCard}>
            <div className={styles.storeHeader}>
              <button
                type="button"
                className={styles.storeToggleBtn}
                onClick={() => setExpandedStore(isExpanded ? null : store.name)}
                aria-expanded={isExpanded}
              >
                <span>{isExpanded ? "▾" : "▸"}</span>
                <span className={styles.badgeIpc}>{store.name}</span>
                <span className={styles.storeSummary}>{store.summary}</span>
              </button>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() =>
                  void navigator.clipboard?.writeText(JSON.stringify(store.data, null, 2))
                }
              >
                Copy
              </button>
            </div>
            {isExpanded && (
              <pre className={styles.storeBody}>{JSON.stringify(store.data, null, 2)}</pre>
            )}
          </div>
        )
      })}
    </>
  )
}

function DebugLogPanel({
  logs,
  envLabel,
  isCapturing,
  storeSnapshots,
  onToggleCapturing,
  onClear,
  onRefreshStores,
}: {
  logs: readonly DebugLogEntry[]
  envLabel: string
  isCapturing: boolean
  storeSnapshots: StoreSnapshotItem[]
  onToggleCapturing: () => void
  onClear: () => void
  onRefreshStores: () => void
}) {
  const [filter, setFilter] = useState<FilterKind>("important")
  const [searchQuery, setSearchQuery] = useState("")
  const [showResponses, setShowResponses] = useState(false)
  const [toggledIds, setToggledIds] = useState<Record<string, boolean>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  const toggleEntryMeta = (id: string, currentlyExpanded: boolean) => {
    setToggledIds((prev) => ({ ...prev, [id]: !currentlyExpanded }))
  }

  const normalizedQuery = searchQuery.trim().toLowerCase()

  const filtered = logs.filter((entry) => {
    if (filter === "important" && !isImportantLog(entry)) return false
    if (filter === "api" && entry.category !== "api") return false
    if (filter === "ipc" && entry.category !== "ipc") return false
    if (filter === "error" && entry.level !== "error") return false
    if (!normalizedQuery) return true
    if (entry.message.toLowerCase().includes(normalizedQuery)) return true
    if (entry.meta === undefined) return false
    const metaText = typeof entry.meta === "string" ? entry.meta : JSON.stringify(entry.meta)
    return metaText.toLowerCase().includes(normalizedQuery)
  })

  const filteredSnapshots = normalizedQuery
    ? storeSnapshots.filter(
        (store) =>
          store.name.toLowerCase().includes(normalizedQuery) ||
          store.summary.toLowerCase().includes(normalizedQuery) ||
          JSON.stringify(store.data).toLowerCase().includes(normalizedQuery),
      )
    : storeSnapshots

  const importantCount = logs.filter(isImportantLog).length
  const apiCount = logs.filter((entry) => entry.category === "api").length
  const errorCount = logs.filter((entry) => entry.level === "error").length

  const handleCopy = () => {
    if (filter === "stores") {
      const snapshot = Object.fromEntries(storeSnapshots.map((s) => [s.name, s.data]))
      void navigator.clipboard?.writeText(JSON.stringify(snapshot, null, 2))
      return
    }
    const text = filtered.map(formatLogEntryText).join("\n")
    void navigator.clipboard?.writeText(text)
  }

  const handleCopyEntry = (entry: DebugLogEntry) => {
    void navigator.clipboard?.writeText(formatLogEntryText(entry))
    setCopiedId(entry.id)
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopiedId(null), DEBUG_LOG_CONFIG.COPY_FEEDBACK_MS)
  }

  return (
    <div className={styles.windowShell}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.envTag}>{envLabel}</span>
          <h2 id="debugLogTitle">Runtime Debug (Logs &amp; Zustand Stores)</h2>
        </div>
        <div className={styles.headerActions}>
          <label className={styles.toggleSwitchLabel} title="Pause or resume capturing logs">
            <input
              type="checkbox"
              className={styles.toggleSwitchInput}
              checked={isCapturing}
              onChange={onToggleCapturing}
            />
            <span className={styles.toggleSwitchTrack} aria-hidden="true">
              <span className={styles.toggleSwitchThumb} />
            </span>
            <span>Capture</span>
            <span
              className={`${styles.toggleSwitchState} ${
                isCapturing ? styles.toggleSwitchStateOn : ""
              }`}
            >
              {isCapturing ? "On" : "Off"}
            </span>
          </label>
          <button type="button" className={styles.actionBtn} onClick={handleCopy}>
            {filter === "stores" ? "Copy All JSON" : "Copy"}
          </button>
          {filter === "stores" ? (
            <button type="button" className={styles.actionBtn} onClick={onRefreshStores}>
              Refresh
            </button>
          ) : (
            <button type="button" className={styles.actionBtn} onClick={onClear}>
              Clear
            </button>
          )}
        </div>
      </div>

      <div className={styles.filterBar}>
        <div className={styles.filterGroup}>
          {(["important", "api", "ipc", "error", "all", "stores"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className={`${styles.filterBtn} ${filter === kind ? styles.active : ""}`}
              onClick={() => {
                setFilter(kind)
                if (kind === "stores") onRefreshStores()
              }}
            >
              {kind === "important"
                ? `Important (${importantCount})`
                : kind === "all"
                  ? `All (${logs.length})`
                  : kind === "api"
                    ? `API (${apiCount})`
                    : kind === "ipc"
                      ? "IPC"
                      : kind === "error"
                        ? `Errors (${errorCount})`
                        : "Zustand Stores"}
            </button>
          ))}
        </div>
        <div className={styles.filterRight}>
          <div className={styles.searchWrap}>
            <input
              type="text"
              className={styles.searchInput}
              placeholder={filter === "stores" ? "Search stores..." : "Search URL, status, keyword..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search logs"
            />
            {searchQuery && (
              <button
                type="button"
                className={styles.searchClearBtn}
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                title="Clear search"
              >
                ×
              </button>
            )}
          </div>
          {filter !== "stores" && (
            <label className={styles.toggleSwitchLabel} title="Toggle API/IPC response payloads">
              <input
                type="checkbox"
                className={styles.toggleSwitchInput}
                checked={showResponses}
                onChange={(e) => {
                  setShowResponses(e.target.checked)
                  setToggledIds({})
                }}
              />
              <span className={styles.toggleSwitchTrack} aria-hidden="true">
                <span className={styles.toggleSwitchThumb} />
              </span>
              <span>Payloads</span>
              <span
                className={`${styles.toggleSwitchState} ${
                  showResponses ? styles.toggleSwitchStateOn : ""
                }`}
              >
                {showResponses ? "On" : "Off"}
              </span>
            </label>
          )}
        </div>
      </div>

      <div className={styles.logList}>
        {filter === "stores" ? (
          filteredSnapshots.length === 0 ? (
            <div className={styles.emptyState}>No stores match &quot;{searchQuery.trim()}&quot;.</div>
          ) : (
            <StoreStateInspector snapshots={filteredSnapshots} />
          )
        ) : filtered.length === 0 ? (
          <div className={styles.emptyState}>
            {normalizedQuery
              ? `No logs match "${searchQuery.trim()}".`
              : isCapturing
                ? "No logs captured yet. Trigger an action (Sign in, Customize, Chat...) to see API/IPC traffic."
                : "Log capturing is paused."}
          </div>
        ) : (
          filtered.map((entry) => {
            const hasMeta = entry.meta !== undefined
            const isMetaExpanded = toggledIds[entry.id] ?? showResponses
            return (
              <div
                key={entry.id}
                className={`${styles.logRow} ${entry.level === "error" ? styles.logError : ""}`}
              >
                <div className={styles.logLine}>
                  <span className={styles.timestamp}>{entry.timestamp}</span>
                  <span className={entry.category === "api" ? styles.badgeApi : styles.badgeIpc}>
                    {entry.category.toUpperCase()}
                  </span>
                  <span className={styles.message}>{entry.message}</span>
                  <span className={styles.logLineActions}>
                    <button
                      type="button"
                      className={styles.metaToggleBtn}
                      onClick={() => handleCopyEntry(entry)}
                      title="Copy this request/response log"
                    >
                      {copiedId === entry.id ? "Copied" : "Copy"}
                    </button>
                    {hasMeta && (
                      <button
                        type="button"
                        className={styles.metaToggleBtn}
                        onClick={() => toggleEntryMeta(entry.id, isMetaExpanded)}
                      >
                        {isMetaExpanded ? "Hide" : "Payload"}
                      </button>
                    )}
                  </span>
                </div>
                {hasMeta && isMetaExpanded && (
                  <pre className={styles.meta}>
                    {typeof entry.meta === "string"
                      ? entry.meta
                      : JSON.stringify(entry.meta, null, 2)}
                  </pre>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

/**
 * Standalone log & store inspector page rendered inside the separate Debug Log window (`?view=logs`).
 */
export function DebugLogWindowPage() {
  const envLabel = getAppEnvironment().toUpperCase()
  const logs = useDebugLogStore((state) => state.entries)
  const isCapturing = useDebugLogStore((state) => state.isCapturing)
  const { toggleCapturing, clearLogs, appendLog } = useDebugLogStore((state) => state.actions)
  const [storeSnapshots, setStoreSnapshots] = useState<StoreSnapshotItem[]>(() =>
    buildLocalStoreSnapshots(),
  )

  useEffect(() => {
    let active = true

    if (window.desktop?.getLogHistory) {
      void window.desktop.getLogHistory().then((history) => {
        if (!active) return
        // History is newest-first; append oldest-first so newest ends up at index 0
        for (let i = history.length - 1; i >= 0; i--) {
          const item = history[i]
          if (!item) continue
          appendLog({
            category: item.category,
            level: item.level,
            message: item.message,
            meta: item.meta,
          })
        }
      })
    }

    const unsubLogs = window.desktop?.subscribeLogEvents?.((entry) => {
      appendLog({
        category: entry.category,
        level: entry.level,
        message: entry.message,
        meta: entry.meta,
      })
    })

    const channel =
      typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(DEBUG_SYNC_CHANNEL) : null
    if (channel) {
      channel.onmessage = (
        event: MessageEvent<{
          type?: string
          entry?: Omit<DebugLogEntry, "id" | "timestamp">
          snapshots?: StoreSnapshotItem[]
        }>,
      ) => {
        if (event.data?.type === "ipc-error-log" && event.data.entry) {
          appendLog(event.data.entry)
        } else if (event.data?.type === "stores-snapshot" && event.data.snapshots) {
          setStoreSnapshots(event.data.snapshots)
        }
      }
      channel.postMessage({ type: "request-stores" })
    }

    return () => {
      active = false
      unsubLogs?.()
      channel?.close()
    }
  }, [appendLog])

  const requestStoreRefresh = () => {
    if (typeof BroadcastChannel === "undefined") return
    const channel = new BroadcastChannel(DEBUG_SYNC_CHANNEL)
    channel.postMessage({ type: "request-stores" })
    channel.close()
  }

  const handleToggleCapturing = () => {
    toggleCapturing()
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(DEBUG_SYNC_CHANNEL)
      channel.postMessage({ type: "toggle-capturing" })
      channel.close()
    }
  }

  const handleClear = () => {
    clearLogs()
    void window.desktop?.clearLogHistory?.()
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(DEBUG_SYNC_CHANNEL)
      channel.postMessage({ type: "clear-logs" })
      channel.close()
    }
  }

  return (
    <DebugLogPanel
      logs={logs}
      envLabel={envLabel}
      isCapturing={isCapturing}
      storeSnapshots={storeSnapshots}
      onToggleCapturing={handleToggleCapturing}
      onClear={handleClear}
      onRefreshStores={requestStoreRefresh}
    />
  )
}

/**
 * Floating log trigger button in the main window; opens the separate Runtime Debug window.
 */
export function DebugLogViewer() {
  const enabled = isDebugLogViewerEnabled()
  const envLabel = getAppEnvironment().toUpperCase()
  const logs = useDebugLogStore((state) => state.entries)
  const isCapturing = useDebugLogStore((state) => state.isCapturing)

  if (!enabled) return null

  const errorCount = logs.filter((entry) => entry.level === "error").length

  return (
    <button
      type="button"
      className={styles.triggerBtn}
      onClick={() => void window.desktop.openLogWindow()}
      title="Open runtime API/IPC logs & Zustand stores in a separate window"
    >
      <span className={styles.envTag}>{envLabel}</span>
      <span>Logs ({logs.length})</span>
      {!isCapturing && <span className={styles.triggerStatusOff}>Off</span>}
      {errorCount > 0 && <span className={styles.errorBadge}>{errorCount}</span>}
    </button>
  )
}
