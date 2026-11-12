import { useEffect, useRef, useState } from "react"
import { MainLayout } from "../../components/layout/MainLayout/MainLayout"
import type { ReasoningEffort } from "../../constants"
import type { ApprovalMode } from "../../../../contracts/permissions"
import { HARNESS_COMMAND_TYPES, HARNESS_EVENT_TYPES } from "../../../../contracts/message-types"
import { useProjectSessions } from "../../hooks/useProjectSessions"
import type { Theme } from "../../theme/ThemeContext"
import { ConversationStream } from "./components/ConversationStream"
import { ProjectSidebar } from "./components/ProjectSidebar"
import { PromptBar } from "./components/PromptBar"
import styles from "./WorkspacePage.module.scss"

interface WorkspacePageProps {
  username: string
  assignedProjectIds: string[]
  onSignOut: () => void
  onShowToast: (message: string) => void
  onThemeChangeToast: (theme: Theme) => void
}

function assertNever(value: never): never {
  throw new Error(`Unhandled harness event: ${JSON.stringify(value)}`)
}

export function WorkspacePage({
  username,
  assignedProjectIds,
  onSignOut,
  onShowToast,
  onThemeChangeToast,
}: WorkspacePageProps) {
  const {
    assignedProjects,
    selectedProjectId,
    currentProject,
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
  } = useProjectSessions(assignedProjectIds)

  const [promptText, setPromptText] = useState("")
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [turn, setTurn] = useState<{
    requestId: string
    sessionId: string
    prompt: string
    assistantText: string
    isStreaming: boolean
    error: string | null
    permission: { id: string; tool: string; action: string; resource: string; reason: string } | null
    question: { id: string; prompt: string; choices?: string[] } | null
    todos: Array<{ content: string; status: "pending" | "in_progress" | "completed" }>
    toolStatus: string | null
  } | null>(null)
  const activeRequestId = useRef<string | null>(null)

  useEffect(() => {
    return window.desktop.subscribeHarnessEvents((event) => {
      if (event.type === HARNESS_EVENT_TYPES.PONG) return
      if (event.requestId !== activeRequestId.current) return
      switch (event.type) {
        case HARNESS_EVENT_TYPES.ASSISTANT_DELTA:
          setTurn((current) => current ? { ...current, assistantText: current.assistantText + event.text } : current)
          return
        case HARNESS_EVENT_TYPES.PERMISSION_REQUIRED:
          setTurn((current) => current ? { ...current, permission: { id: event.permissionRequestId, tool: event.tool, action: event.action, resource: event.resource, reason: event.reason } } : current)
          return
        case HARNESS_EVENT_TYPES.PERMISSION_EXPIRED:
          setTurn((current) => current ? { ...current, permission: null, error: "Permission request expired. The operation was denied." } : current)
          return
        case HARNESS_EVENT_TYPES.QUESTION_REQUIRED:
          setTurn((current) => current ? { ...current, question: { id: event.questionRequestId, prompt: event.prompt, choices: event.choices } } : current)
          return
        case HARNESS_EVENT_TYPES.QUESTION_EXPIRED:
          setTurn((current) => current ? { ...current, question: null, error: "The question timed out. The agent can continue without an answer." } : current)
          return
        case HARNESS_EVENT_TYPES.TODO_UPDATED:
          setTurn((current) => current ? { ...current, todos: event.todos } : current)
          return
        case HARNESS_EVENT_TYPES.TOOL_STARTED:
          setTurn((current) => current ? { ...current, toolStatus: `Running ${event.toolName}…` } : current)
          return
        case HARNESS_EVENT_TYPES.TOOL_COMPLETED:
          setTurn((current) => current ? { ...current, toolStatus: null } : current)
          return
        case HARNESS_EVENT_TYPES.TOOL_FAILED:
          setTurn((current) => current ? { ...current, toolStatus: `${event.toolName} failed: ${event.message}` } : current)
          return
        case HARNESS_EVENT_TYPES.CHAT_COMPLETED:
          setTurn((current) => current ? { ...current, isStreaming: false } : current)
          return
        case HARNESS_EVENT_TYPES.CHAT_FAILED:
          setTurn((current) => current ? { ...current, isStreaming: false, error: event.message } : current)
          return
        default:
          return assertNever(event)
      }
    })
  }, [])

  const handleNewChat = () => {
    createNewChat(selectedProjectId)
    setPromptText("")
  }

  const handleSendPrompt = (model: string, _effort: ReasoningEffort, approvalMode: ApprovalMode) => {
    const prompt = promptText.trim()
    if (!prompt || !activeSessionId) return
    const requestId = crypto.randomUUID()
    const sessionId = String(activeSessionId)
    activeRequestId.current = requestId
    setTurn({ requestId, sessionId, prompt, assistantText: "", isStreaming: true, error: null, permission: null, question: null, todos: [], toolStatus: null })
    window.desktop.sendHarnessCommand({ type: HARNESS_COMMAND_TYPES.CHAT_SUBMIT, requestId, sessionId, prompt, model, workspacePath: workspacePath ?? undefined, approvalMode })
    setPromptText("")
  }

  const sidebarContent = (
    <ProjectSidebar
      projects={assignedProjects}
      selectedProjectId={selectedProjectId}
      sessions={sessions}
      activeSessionId={activeSessionId}
      expandedProjects={expandedProjects}
      onSelectProject={selectProject}
      onToggleExpandProject={toggleExpandProject}
      onSelectSession={selectSession}
      onNewChat={handleNewChat}
      onRenameSession={renameSession}
      onDeleteSession={deleteSession}
    />
  )

  return (
    <MainLayout
      username={username}
      onSignOut={onSignOut}
      onThemeChangeToast={onThemeChangeToast}
      sidebarContent={sidebarContent}
    >
      {turn || activeSession?.hasHistory ? (
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
              toolStatus={turn.toolStatus}
              onPermissionDecision={(id, decision) => {
                window.desktop.respondToPermission(id, decision)
                setTurn((current) => current ? { ...current, permission: null } : current)
              }}
              onQuestionAnswer={(id, answer) => {
                window.desktop.respondToQuestion(id, answer)
                setTurn((current) => current ? { ...current, question: null } : current)
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
        </div>
      )}

      <PromptBar
        promptText={promptText}
        onPromptChange={setPromptText}
        onSendPrompt={handleSendPrompt}
        isBusy={Boolean(turn?.isStreaming)}
        onWorkspacePathChange={setWorkspacePath}
      />
    </MainLayout>
  )
}
