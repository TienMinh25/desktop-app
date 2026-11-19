import { useEffect, useState } from "react"
import { MainLayout } from "../../components/layout/MainLayout/MainLayout"
import type { ReasoningEffort } from "../../constants"
import type { ApprovalMode } from "../../../../contracts/permissions"
import { HARNESS_COMMAND_TYPES, HARNESS_EVENT_TYPES } from "../../../../contracts/message-types"
import { useProjectSessions } from "../../hooks/useProjectSessions"
import type { Theme } from "../../theme/ThemeContext"
import type { TodoItem } from "../../../../contracts/todos"
import { ConversationStream } from "./components/ConversationStream/ConversationStream"
import { CustomizePanel } from "./components/CustomizePanel/CustomizePanel"
import { ProjectSidebar } from "./components/ProjectSidebar/ProjectSidebar"
import { NoProjectPage } from "../NoProjectPage/NoProjectPage"
import { PromptBar } from "./components/PromptBar/PromptBar"
import styles from "./WorkspacePage.module.scss"

interface WorkspacePageProps {
  username: string
  onSignOut: () => void
  onShowToast: (message: string) => void
  onThemeChangeToast: (theme: Theme) => void
}

interface TurnState {
  requestId: string
  sessionId: string
  prompt: string
  assistantText: string
  isStreaming: boolean
  error: string | null
  permission: { id: string; tool: string; action: string; resource: string; reason: string } | null
  question: { id: string; prompt: string; choices?: string[] } | null
  todos: TodoItem[]
  toolStatus: string | null
}

function updateMatchingTurn(
  turns: Record<string, TurnState>,
  sessionId: string,
  requestId: string,
  update: (turn: TurnState) => TurnState,
): Record<string, TurnState> {
  const turn = turns[sessionId]
  if (!turn || turn.requestId !== requestId) return turns
  return { ...turns, [sessionId]: update(turn) }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled harness event: ${JSON.stringify(value)}`)
}

export function WorkspacePage({
  username,
  onSignOut,
  onShowToast,
  onThemeChangeToast,
}: WorkspacePageProps) {
  const {
    assignedProjects,
    loadError,
    isLoaded,
    selectedProjectId,
    sessions,
    activeSessionId,
    activeSession,
    expandedProjects,
    selectProject,
    toggleExpandProject,
    selectSession,
    createNewChat,
    renameSession,
    deleteSession,
  } = useProjectSessions(onShowToast)

  useEffect(() => {
    if (loadError) onShowToast(`Could not load projects from backend: ${loadError}`)
  }, [loadError, onShowToast])

  const [promptText, setPromptText] = useState("")
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false)
  const [customizeInitialTab, setCustomizeInitialTab] = useState<"connectors" | "lsp">("connectors")
  const [hasEnabledLspServer, setHasEnabledLspServer] = useState<boolean | null>(null)
  const [turns, setTurns] = useState<Record<string, TurnState>>({})
  const [queuedPrompts, setQueuedPrompts] = useState<Record<string, Array<{ requestId: string; prompt: string }>>>({})

  useEffect(() => {
    return window.desktop.subscribeHarnessEvents((event) => {
      if (event.type === HARNESS_EVENT_TYPES.PONG) return
      switch (event.type) {
        case HARNESS_EVENT_TYPES.CHAT_QUEUED:
          setQueuedPrompts((current) => {
            const queue = [...(current[event.sessionId] ?? [])]
            const index = Math.min(queue.length, Math.max(0, event.queuePosition - 1))
            queue.splice(index, 0, { requestId: event.requestId, prompt: event.prompt })
            return { ...current, [event.sessionId]: queue }
          })
          return
        case HARNESS_EVENT_TYPES.CHAT_STARTED:
          setQueuedPrompts((current) => ({
            ...current,
            [event.sessionId]: (current[event.sessionId] ?? []).filter((item) => item.requestId !== event.requestId),
          }))
          setTurns((current) => ({ ...current, [event.sessionId]: {
            requestId: event.requestId,
            sessionId: event.sessionId,
            prompt: event.prompt,
            assistantText: "",
            isStreaming: true,
            error: null,
            permission: null,
            question: null,
            todos: [],
            toolStatus: null,
          } }))
          return
        case HARNESS_EVENT_TYPES.ASSISTANT_DELTA:
          setTurns((current) => updateMatchingTurn(current, event.sessionId, event.requestId, (turn) => ({ ...turn, assistantText: turn.assistantText + event.text })))
          return
        case HARNESS_EVENT_TYPES.PERMISSION_REQUIRED:
          setTurns((current) => updateMatchingTurn(current, event.sessionId, event.requestId, (turn) => ({ ...turn, permission: { id: event.permissionRequestId, tool: event.tool, action: event.action, resource: event.resource, reason: event.reason } })))
          return
        case HARNESS_EVENT_TYPES.PERMISSION_EXPIRED:
          setTurns((current) => updateMatchingTurn(current, event.sessionId, event.requestId, (turn) => ({ ...turn, permission: null, error: "Permission request expired. The operation was denied." })))
          return
        case HARNESS_EVENT_TYPES.QUESTION_REQUIRED:
          setTurns((current) => updateMatchingTurn(current, event.sessionId, event.requestId, (turn) => ({ ...turn, question: { id: event.questionRequestId, prompt: event.prompt, choices: event.choices } })))
          return
        case HARNESS_EVENT_TYPES.QUESTION_EXPIRED:
          setTurns((current) => updateMatchingTurn(current, event.sessionId, event.requestId, (turn) => ({ ...turn, question: null, error: "The question timed out. The agent can continue without an answer." })))
          return
        case HARNESS_EVENT_TYPES.TODO_UPDATED:
          setTurns((current) => updateMatchingTurn(current, event.sessionId, event.requestId, (turn) => ({ ...turn, todos: event.todos })))
          return
        case HARNESS_EVENT_TYPES.TOOL_STARTED:
          setTurns((current) => updateMatchingTurn(current, event.sessionId, event.requestId, (turn) => ({ ...turn, toolStatus: `Running ${event.toolName}…` })))
          return
        case HARNESS_EVENT_TYPES.TOOL_COMPLETED:
          setTurns((current) => updateMatchingTurn(current, event.sessionId, event.requestId, (turn) => ({ ...turn, toolStatus: null })))
          return
        case HARNESS_EVENT_TYPES.TOOL_FAILED:
          setTurns((current) => updateMatchingTurn(current, event.sessionId, event.requestId, (turn) => ({ ...turn, toolStatus: `${event.toolName} failed: ${event.message}` })))
          return
        case HARNESS_EVENT_TYPES.CHAT_COMPLETED:
          setTurns((current) => updateMatchingTurn(current, event.sessionId, event.requestId, (turn) => ({ ...turn, isStreaming: false })))
          return
        case HARNESS_EVENT_TYPES.CHAT_FAILED:
          setQueuedPrompts((current) => ({
            ...current,
            [event.sessionId]: (current[event.sessionId] ?? []).filter((item) => item.requestId !== event.requestId),
          }))
          setTurns((current) => updateMatchingTurn(current, event.sessionId, event.requestId, (turn) => ({ ...turn, isStreaming: false, error: event.message })))
          return
        default:
          return assertNever(event)
      }
    })
  }, [])

  useEffect(() => {
    let active = true
    void window.desktop.listLspServers().then((servers) => {
      if (active) setHasEnabledLspServer(servers.some((server) => server.enabled))
    }).catch(() => {
      if (active) setHasEnabledLspServer(false)
    })
    return () => { active = false }
  }, [isCustomizeOpen])

  const handleNewChat = () => {
    setIsCustomizeOpen(false)
    createNewChat(selectedProjectId)
    setPromptText("")
  }

  const handleSelectProject = (projectId: string) => {
    setIsCustomizeOpen(false)
    selectProject(projectId)
  }

  const handleSelectSession = (sessionId: string) => {
    setIsCustomizeOpen(false)
    selectSession(sessionId)
  }

  const handleSendPrompt = (model: string, _effort: ReasoningEffort, approvalMode: ApprovalMode) => {
    const prompt = promptText.trim()
    if (!prompt || !activeSessionId) return
    const requestId = crypto.randomUUID()
    const sessionId = String(activeSessionId)
    window.desktop.sendHarnessCommand({ type: HARNESS_COMMAND_TYPES.CHAT_SUBMIT, requestId, sessionId, prompt, model, workspacePath: workspacePath ?? undefined, approvalMode })
    setPromptText("")
  }

  const handleDeleteSession = async (sessionId: string) => {
    if (!(await deleteSession(sessionId))) return
    const runtimeSessionId = String(sessionId)
    window.desktop.sendHarnessCommand({ type: HARNESS_COMMAND_TYPES.SESSION_DELETE, sessionId: runtimeSessionId })
    setTurns((current) => { const next = { ...current }; delete next[runtimeSessionId]; return next })
    setQueuedPrompts((current) => { const next = { ...current }; delete next[runtimeSessionId]; return next })
  }

  const turn = activeSessionId === null ? undefined : turns[String(activeSessionId)]
  const activeQueue = activeSessionId === null ? [] : queuedPrompts[String(activeSessionId)] ?? []

  const sidebarContent = (
    <ProjectSidebar
      projects={assignedProjects}
      selectedProjectId={isCustomizeOpen ? null : selectedProjectId}
      sessions={sessions}
      activeSessionId={isCustomizeOpen ? null : activeSessionId}
      expandedProjects={expandedProjects}
      isCustomizeActive={isCustomizeOpen}
      onSelectCustomize={() => {
        setCustomizeInitialTab("connectors")
        setIsCustomizeOpen(true)
      }}
      onSelectProject={handleSelectProject}
      onToggleExpandProject={toggleExpandProject}
      onSelectSession={handleSelectSession}
      onNewChat={handleNewChat}
      onRenameSession={renameSession}
      onDeleteSession={handleDeleteSession}
    />
  )

  if (isLoaded && !loadError && assignedProjects.length === 0) {
    return <NoProjectPage username={username} onSignOut={onSignOut} onThemeChangeToast={onThemeChangeToast} />
  }

  return (
    <MainLayout
      username={username}
      onSignOut={onSignOut}
      onThemeChangeToast={onThemeChangeToast}
      sidebarContent={sidebarContent}
    >
      {isCustomizeOpen ? (
        <CustomizePanel onShowToast={onShowToast} initialTab={customizeInitialTab} />
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
                  onPermissionDecision={(id, decision) => {
                    window.desktop.respondToPermission(id, decision)
                    setTurns((current) => updateMatchingTurn(current, turn.sessionId, turn.requestId, (currentTurn) => ({ ...currentTurn, permission: null })))
                  }}
                  onQuestionAnswer={(id, answer) => {
                    window.desktop.respondToQuestion(id, answer)
                    setTurns((current) => updateMatchingTurn(current, turn.sessionId, turn.requestId, (currentTurn) => ({ ...currentTurn, question: null })))
                  }}
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
              {hasEnabledLspServer === false && <button className={styles.lspSetupLink} type="button" onClick={() => {
                setCustomizeInitialTab("lsp")
                setIsCustomizeOpen(true)
              }}>
                Set up LSP for code navigation
              </button>}
            </div>
          )}

          <PromptBar
            promptText={promptText}
            onPromptChange={setPromptText}
            onSendPrompt={handleSendPrompt}
            onWorkspacePathChange={setWorkspacePath}
          />
        </>
      )}
    </MainLayout>
  )
}
