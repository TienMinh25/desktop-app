import { useEffect } from "react"
import { MainLayout } from "../../components/layout/MainLayout/MainLayout"
import { toast, useChatStore, useCustomizeStore, useProjectStore } from "../../stores"
import { ConversationStream } from "./components/ConversationStream/ConversationStream"
import { CustomizePanel } from "./components/CustomizePanel/CustomizePanel"
import { ProjectSidebar } from "./components/ProjectSidebar/ProjectSidebar"
import { PromptBar } from "./components/PromptBar/PromptBar"
import styles from "./WorkspacePage.module.scss"

export function WorkspacePage() {
  const loadError = useProjectStore((state) => state.loadError)
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId)
  const sessions = useProjectStore((state) => state.sessions)
  const activeSessionId = useProjectStore((state) => state.activeSessionId)

  const turns = useChatStore((state) => state.turns)
  const queuedPrompts = useChatStore((state) => state.queuedPrompts)
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

  const turn = activeSessionId === null ? undefined : turns[String(activeSessionId)]
  const activeQueue = activeSessionId === null ? [] : queuedPrompts[String(activeSessionId)] ?? []

  return (
    <MainLayout sidebarContent={<ProjectSidebar />}>
      {isCustomizeOpen ? (
        <CustomizePanel />
      ) : (
        <>
          {turn || activeQueue.length > 0 || activeSession?.hasHistory ? (
            <>
              <div className={styles.chatTopHeader}>
                <span>{activeSession?.title ?? "New chat"}</span>
              </div>
              {turn ? (
                <ConversationStream
                  userPrompt={turn.prompt}
                  assistantText={turn.assistantText}
                  isStreaming={turn.isStreaming}
                  error={turn.error}
                  permission={turn.permission}
                  question={turn.question}
                  todos={turn.todos}
                  pendingPrompts={activeQueue}
                  toolStatus={turn.toolStatus}
                  onPermissionDecision={(id, decision) =>
                    respondToPermission(turn.sessionId, turn.requestId, id, decision)
                  }
                  onQuestionAnswer={(id, answer) =>
                    respondToQuestion(turn.sessionId, turn.requestId, id, answer)
                  }
                />
              ) : null}
            </>
          ) : (
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
