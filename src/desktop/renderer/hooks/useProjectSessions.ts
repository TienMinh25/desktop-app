import { useEffect, useState } from "react"
import type { ProjectsListResult, SessionRow } from "../../../contracts/projects"

export interface ProjectItem {
  id: string
  key: string
  name: string
}

export interface ChatSession {
  id: string
  projectId: string
  title: string
  hasHistory: boolean
  updatedAt: number
}

export function useProjectSessions(onError: (message: string) => void) {
  const [assignedProjects, setAssignedProjects] = useState<ProjectItem[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({})

  useEffect(() => {
    // StrictMode mounts twice in dev, only the live mount may create or set state
    let cancelled = false
    let firstChatCreated = false
    const apply = async ({ projects, syncedAt, error }: ProjectsListResult) => {
      // Fresh DB and the first sync still running, its projects:changed brings the list
      if (projects.length === 0 && syncedAt === null && error === null) return
      const active = projects.filter((project) => project.memberStatus === "active")
      const sessionLists = await Promise.all(active.map((project) => window.desktop.listSessions(project.id)))
      if (cancelled) return
      // The prompt bar needs an active chat, same as selecting an empty project
      if (!firstChatCreated && active[0] && sessionLists[0]?.length === 0) {
        firstChatCreated = true
        sessionLists[0] = [await window.desktop.createSession(active[0].id, "New chat #1")]
        if (cancelled) return
      }
      const loaded = sessionLists.flat().map(toChatSession)
      const firstProjectId = active[0]?.id ?? null
      setLoadError(error)
      setAssignedProjects(active.map(({ id, key, name }) => ({ id, key, name })))
      setExpandedProjects((prev) => Object.fromEntries(active.map((project) => [project.id, prev[project.id] ?? true])))
      setSessions(loaded)
      // A sync every 10 min must not move the user, reset only when the project was unassigned
      setSelectedProjectId((current) => (current && active.some((project) => project.id === current) ? current : firstProjectId))
      setActiveSessionId((current) => (current && loaded.some((session) => session.id === current)
        ? current
        : loaded.find((session) => session.projectId === firstProjectId)?.id ?? null))
      setIsLoaded(true)
    }
    const fail = (cause: unknown) => {
      if (cancelled) return
      setLoadError(cause instanceof Error ? cause.message : String(cause))
      setIsLoaded(true)
    }
    const unsubscribe = window.desktop.subscribeProjectsChanged((result) => void apply(result).catch(fail))
    window.desktop.listProjects().then(apply).catch(fail)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const isAssigned = (projectId: string) => assignedProjects.some((project) => project.id === projectId)
  const currentProject = assignedProjects.find((p) => p.id === selectedProjectId) ?? null
  const activeSession = sessions.find(
    (s) => s.id === activeSessionId && s.projectId === selectedProjectId,
  )

  const reportError = (action: string, cause: unknown) =>
    onError(`Could not ${action}: ${cause instanceof Error ? cause.message : String(cause)}`)

  const createNewChat = async (projectId: string | null = selectedProjectId) => {
    if (!projectId || !isAssigned(projectId)) return
    const count = sessions.filter((s) => s.projectId === projectId).length
    let row: SessionRow
    try {
      row = await window.desktop.createSession(projectId, `New chat #${count + 1}`)
    } catch (cause) {
      return reportError("create chat", cause)
    }
    setSessions((prev) => [toChatSession(row), ...prev])
    setActiveSessionId(row.id)
  }

  const selectProject = (projectId: string) => {
    if (!isAssigned(projectId)) return
    setSelectedProjectId(projectId)
    const scoped = sessions
      .filter((s) => s.projectId === projectId)
      .sort(newestFirst)

    if (scoped.length > 0 && scoped[0]) {
      setActiveSessionId(scoped[0].id)
    } else {
      void createNewChat(projectId)
    }
  }

  const toggleExpandProject = (projectId: string) => {
    setExpandedProjects((prev) => ({
      ...prev,
      [projectId]: !prev[projectId],
    }))
  }

  const selectSession = (sessionId: string) => {
    const target = sessions.find((s) => s.id === sessionId)
    if (!target || !isAssigned(target.projectId)) return
    setSelectedProjectId(target.projectId)
    setActiveSessionId(target.id)
  }

  const renameSession = async (sessionId: string, title: string) => {
    const newTitle = title.trim()
    if (!newTitle) return
    try {
      await window.desktop.renameSession(sessionId, newTitle)
    } catch (cause) {
      return reportError("rename chat", cause)
    }
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s)))
  }

  const deleteSession = async (sessionId: string): Promise<boolean> => {
    if (!window.confirm("Delete this chat session?")) return false
    try {
      await window.desktop.deleteSession(sessionId)
    } catch (cause) {
      reportError("delete chat", cause)
      return false
    }
    // Functional update so chats created while the delete was pending are kept
    setSessions((prev) => prev.filter((s) => s.id !== sessionId))

    if (sessionId === activeSessionId && selectedProjectId) {
      const next = sessions
        .filter((s) => s.id !== sessionId && s.projectId === selectedProjectId)
        .sort(newestFirst)[0]

      if (next) {
        setActiveSessionId((current) => (current === sessionId ? next.id : current))
      } else {
        void createNewChat(selectedProjectId)
      }
    }
    return true
  }

  return {
    assignedProjects,
    loadError,
    isLoaded,
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
  }
}

// History is not loaded from the DB yet, so a reopened chat starts empty
function toChatSession(row: SessionRow): ChatSession {
  return { id: row.id, projectId: row.projectId, title: row.title, hasHistory: false, updatedAt: row.updatedAt }
}

export const newestFirst = (a: ChatSession, b: ChatSession) => b.updatedAt - a.updatedAt
