import { useState } from "react"
import { MainLayout } from "../../components/layout/MainLayout/MainLayout"
import type { ReasoningEffort } from "../../constants"
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

  const handleNewChat = () => {
    createNewChat(selectedProjectId)
    setPromptText("")
  }

  const handleSendPrompt = (model: string, effort: ReasoningEffort) => {
    const trimmed = promptText.trim()
    if (!trimmed || !currentProject) return
    window.alert(`Prompt sent to [${model}] (${effort} reasoning):\n\n"${trimmed}"`)
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
      {activeSession?.hasHistory ? (
        <>
          <div className={styles.chatTopHeader}>
            <span>{activeSession.title}</span>
          </div>
          <ConversationStream onShowToast={onShowToast} />
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
        workspaceName={currentProject?.name ?? "Workspace"}
        promptText={promptText}
        onPromptChange={setPromptText}
        onSendPrompt={handleSendPrompt}
      />
    </MainLayout>
  )
}