import { useEffect } from "react"
import { MainLayout } from "../../components/layout/MainLayout/MainLayout"
import {
  resolveHistoryTurns,
  toast,
  useChatStore,
  useCustomizeStore,
  useProjectStore,
} from "../../stores"
import { ConversationStream } from "./components/ConversationStream/ConversationStream"
import { CustomizePanel } from "./components/CustomizePanel/CustomizePanel"
import { ProjectSidebar } from "./components/ProjectSidebar/ProjectSidebar"
import { PromptBar } from "./components/PromptBar/PromptBar"
import styles from "./WorkspacePage.module.scss"

/** Which chat pane to show: the stream, a failed first load, nothing while loading, or the greeting. */
export function chatPaneView(input: {
  hasContent: boolean
  activeSessionId: string | null
  historyLoaded: boolean
  historyFailed: boolean
}): "stream" | "failed" | "loading" | "greeting" {
  if (input.hasContent) return "stream"
  if (input.historyFailed) return "failed"
  // Wait for the history load so an old session does not flash the greeting
  if (input.activeSessionId !== null && !input.historyLoaded) return "loading"
  return "greeting"
}

export function WorkspacePage() {
  const loadError = useProjectStore((state) => state.loadError)
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId)
  const sessions = useProjectStore((state) => state.sessions)
  const activeSessionId = useProjectStore((state) => state.activeSessionId)

  const turn = useChatStore((state) => activeSessionId === null ? undefined : state.turns[activeSessionId])
  const queue = useChatStore((state) => activeSessionId === null ? undefined : state.queuedPrompts[activeSessionId])
  const history = useChatStore((state) => activeSessionId === null ? undefined : state.history[activeSessionId])
  const retiredTurns = useChatStore((state) => activeSessionId === null ? undefined : state.retiredTurns[activeSessionId])
  const historyFailed = useChatStore((state) => activeSessionId !== null && Boolean(state.historyFailed[activeSessionId]))
  const loadHistory = useChatStore((state) => state.loadHistory)
  const pendingTurns = useChatStore((state) => activeSessionId === null ? undefined : state.pendingHistoryTurns[activeSessionId])
  const subscribeHarness = useChatStore((state) => state.subscribeHarness)
  const respondToPermission = useChatStore((state) => state.respondToPermission)
  const respondToQuestion = useChatStore((state) => state.respondToQuestion)

  const isCustomizeOpen = useCustomizeStore((state) => state.isOpen)
  const hasEnabledLspServer = useCustomizeStore((state) => state.hasEnabledLspServer)
  const openCustomize = useCustomizeStore((state) => state.openCustomize)
  const refreshLspStatus = useCustomizeStore((state) => state.refreshLspStatus)

  const activeSession = sessions.find(
    (s) => s.id === activeSessionId && s.projectId === selectedProjectId,
  )

  useEffect(() => {
    if (loadError) toast.error(`Could not load projects from backend: ${loadError}`)
  }, [loadError])

  useEffect(() => subscribeHarness(), [subscribeHarness])

  useEffect(() => {
    void refreshLspStatus()
  }, [refreshLspStatus])

  const activeQueue = queue ?? []
  const visibleHistory = resolveHistoryTurns(history ?? [], turn, pendingTurns)
  const pane = chatPaneView({
    hasContent: Boolean(turn) || activeQueue.length > 0 || Boolean(pendingTurns?.length) || visibleHistory.length > 0,
    activeSessionId,
    historyLoaded: history !== undefined,
    historyFailed,
  })

  return (
    <MainLayout sidebarContent={<ProjectSidebar />}>
      {isCustomizeOpen ? (
        <CustomizePanel />
      ) : (
        <>
          {pane === "stream" ? (
            <>
              <div className={styles.chatTopHeader}>
                <span>{activeSession?.title ?? "New chat"}</span>
              </div>
              <ConversationStream
                key={activeSessionId ?? undefined}
                historyTurns={visibleHistory}
                retiredTurns={retiredTurns}
                pendingHistoryTurns={pendingTurns}
                liveTurn={turn}
                pendingPrompts={activeQueue}
                onPermissionDecision={(id, decision) => {
                  if (turn) respondToPermission(turn.sessionId, turn.requestId, id, decision)
                }}
                onQuestionAnswer={(id, answer) => {
                  if (turn) respondToQuestion(turn.sessionId, turn.requestId, id, answer)
                }}
              />
            </>
          ) : pane === "failed" ? (
            <div className={styles.centerGreeting} role="alert">
              <p>Could not load this chat.</p>
              <button type="button" onClick={() => void loadHistory(activeSessionId)}>Retry</button>
            </div>
          ) : pane === "loading" ? null : (
            <div className={styles.centerGreeting}>
              <svg
                className={styles.cloudIcon}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <path
                  d="M6.5 18C4 18 2 16 2 13.5C2 11.2 3.6 9.3 5.8 9C6.4 5.6 9.4 3 13 3C17.1 3 20.5 6.1 20.9 10.1C21.6 10.6 22 11.5 22 12.5C22 14.4 20.4 16 18.5 16H18"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M9 13l2-2-2-2M15 13l-2-2 2-2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <h1 className={styles.heroTitle}>What should we build?</h1>
              {hasEnabledLspServer === false && (
                <button
                  className={styles.lspSetupLink}
                  type="button"
                  onClick={() => openCustomize("lsp")}
                >
                  Set up LSP for code navigation
                </button>
              )}
            </div>
          )}

          <PromptBar />
        </>
      )}
    </MainLayout>
  )
}
