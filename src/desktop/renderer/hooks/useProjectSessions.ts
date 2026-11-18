import { useEffect, useState } from "react"
import type { SessionRow } from "../../main/db"
import type { ChatSession, ProjectItem } from "../data/mockData"

export function useProjectSessions(onError: (message: string) => void) {
  const [assignedProjects, setAssignedProjects] = useState<ProjectItem[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({})

  useEffect(() => {
    void (async () => {
      try {
        const { projects, error } = await window.desktop.listProjects()
        const active = projects.filter((project) => project.memberStatus === "active")
        const sessionLists = await Promise.all(active.map((project) => window.desktop.listSessions(project.id)))
        setLoadError(error)
        setAssignedProjects(active.map((project) => ({ id: project.id, name: project.name, key: "", folder: "" })))
        setExpandedProjects(Object.fromEntries(active.map((project) => [project.id, true])))
        setSessions(sessionLists.flatMap((rows, index) => rows.map((row, order) => ({
          id: row.id,
          projectId: active[index]!.id,
          title: row.title,
          hasHistory: false,
          projectOrder: order,
        }))))
        setSelectedProjectId(active[0]?.id ?? null)
        setActiveSessionId(sessionLists[0]?.[0]?.id ?? null)
      } catch (cause) {
        setLoadError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setIsLoaded(true)
      }
    })()
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
    setSessions((prev) => {
      const projectSessions = prev.filter((s) => s.projectId === projectId)
      const minOrder = projectSessions.length
        ? Math.min(...projectSessions.map((s) => s.projectOrder)) - 1
        : 1
      const newSession: ChatSession = {
        id: row.id,
        projectId,
        title: row.title,
        hasHistory: false,
        projectOrder: minOrder,
      }
      return [newSession, ...prev]
    })
    setActiveSessionId(row.id)
  }

  const selectProject = (projectId: string) => {
    if (!isAssigned(projectId)) return
    setSelectedProjectId(projectId)
    const scoped = sessions
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => a.projectOrder - b.projectOrder)

    if (scoped.length > 0 && scoped[0]) {
      setActiveSessionId(scoped[0].id)
    } else {
      createNewChat(projectId)
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
    const wasActive = sessionId === activeSessionId
    const remaining = sessions.filter((s) => s.id !== sessionId)
    setSessions(remaining)

    if (wasActive && selectedProjectId) {
      const remainingInProject = remaining
        .filter((s) => s.projectId === selectedProjectId)
        .sort((a, b) => a.projectOrder - b.projectOrder)

      if (remainingInProject.length > 0 && remainingInProject[0]) {
        setActiveSessionId(remainingInProject[0].id)
      } else {
        createNewChat(selectedProjectId)
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
