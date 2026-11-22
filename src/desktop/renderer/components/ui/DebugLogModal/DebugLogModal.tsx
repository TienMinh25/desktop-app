import { useRef, useState } from "react"
import { useModalFocusLock } from "../../../hooks/useModalFocusLock"
import {
  getAppEnvironment,
  isDebugLogViewerEnabled,
  useAuthStore,
  useChatStore,
  useCustomizeStore,
  useDebugLogStore,
  useProjectStore,
  usePromptSettingsStore,
  useThemeStore,
  useToastStore,
  type DebugLogEntry,
} from "../../../stores"
import styles from "./DebugLogModal.module.scss"

type FilterKind = "all" | "api" | "ipc" | "error" | "stores"

function stripFunctions(value: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, val]) => typeof val !== "function"),
  )
}

interface StoreSnapshotItem {
  name: string
  summary: string
  data: Record<string, unknown>
}

function StoreStateInspector() {
  const auth = useAuthStore((s) => s)
  const theme = useThemeStore((s) => s)
  const toast = useToastStore((s) => s)
  const project = useProjectStore((s) => s)
  const chat = useChatStore((s) => s)
  const promptSettings = usePromptSettingsStore((s) => s)
  const customize = useCustomizeStore((s) => s)
  const [expandedStore, setExpandedStore] = useState<string | null>("AuthStore")

  const stores: StoreSnapshotItem[] = [
    {
      name: "AuthStore",
      summary: auth.authState?.authenticated
        ? `signed in: ${auth.authState.username ?? ""}`
        : "signed out",
      data: stripFunctions(auth),
    },
    {
      name: "ProjectStore",
      summary: `${project.assignedProjects.length} projects · ${project.sessions.length} sessions`,
      data: stripFunctions(project),
    },
    {
      name: "ChatStore",
      summary: `${Object.keys(chat.turns).length} active turns`,
      data: stripFunctions(chat),
    },
    {
      name: "PromptSettingsStore",
      summary: `${promptSettings.selectedModel} · ${promptSettings.selectedEffort} · ${promptSettings.approvalMode}`,
      data: stripFunctions(promptSettings),
    },
    {
      name: "CustomizeStore",
      summary: `${customize.isOpen ? `open (${customize.initialTab})` : "closed"} · LSP=${String(customize.hasEnabledLspServer)}`,
      data: stripFunctions(customize),
    },
    {
      name: "ThemeStore",
      summary: theme.theme,
      data: stripFunctions(theme),
    },
    {
      name: "ToastStore",
      summary: toast.activeToast ? `${toast.activeToast.type}: ${toast.activeToast.message}` : "idle",
      data: stripFunctions(toast),
    },
  ]

  return (
    <>
      {stores.map((store) => {
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

function DebugLogDialog({
  logs,
  envLabel,
  onClear,
  onClose,
}: {
  logs: readonly DebugLogEntry[]
  envLabel: string
  onClear: () => void
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
    if (filter === "stores") {
      const snapshot = {
        AuthStore: stripFunctions(useAuthStore.getState()),
        ProjectStore: stripFunctions(useProjectStore.getState()),
        ChatStore: stripFunctions(useChatStore.getState()),
        PromptSettingsStore: stripFunctions(usePromptSettingsStore.getState()),
        CustomizeStore: stripFunctions(useCustomizeStore.getState()),
        ThemeStore: stripFunctions(useThemeStore.getState()),
        ToastStore: stripFunctions(useToastStore.getState()),
      }
      void navigator.clipboard?.writeText(JSON.stringify(snapshot, null, 2))
      return
    }
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
            <h2 id="debugLogTitle">Runtime Debug (Logs &amp; Zustand Stores)</h2>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.actionBtn} onClick={handleCopy}>
              {filter === "stores" ? "Copy All JSON" : "Copy"}
            </button>
            {filter !== "stores" && (
              <button type="button" className={styles.actionBtn} onClick={onClear}>
                Clear
              </button>
            )}
            <button ref={closeBtnRef} type="button" className={styles.actionBtn} onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className={styles.filterBar}>
          {(["all", "api", "ipc", "error", "stores"] as const).map((kind) => (
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
                    : kind === "error"
                      ? `Errors (${logs.filter((l) => l.level === "error").length})`
                      : "Zustand Stores"}
            </button>
          ))}
        </div>

        <div className={styles.logList}>
          {filter === "stores" ? (
            <StoreStateInspector />
          ) : filtered.length === 0 ? (
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
 * Floating log & store inspector modal, active only on non-prod environments (SIT / UAT).
 */
export function DebugLogViewer() {
  const enabled = isDebugLogViewerEnabled()
  const envLabel = getAppEnvironment().toUpperCase()
  const [isOpen, setIsOpen] = useState(false)
  const logs = useDebugLogStore((state) => state.entries)
  const clearLogs = useDebugLogStore((state) => state.clearLogs)

  if (!enabled) return null

  const errorCount = logs.filter((entry) => entry.level === "error").length

  return (
    <>
      <button
        type="button"
        className={styles.triggerBtn}
        onClick={() => setIsOpen(true)}
        title="Open runtime API/IPC logs & Zustand stores"
      >
        <span className={styles.envTag}>{envLabel}</span>
        <span>Logs ({logs.length})</span>
        {errorCount > 0 && <span className={styles.errorBadge}>{errorCount}</span>}
      </button>

      {isOpen && (
        <DebugLogDialog
          logs={logs}
          envLabel={envLabel}
          onClear={clearLogs}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  )
}
