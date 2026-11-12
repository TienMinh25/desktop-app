import { useState } from "react"
import { INITIAL_SESSIONS, PROJECT_CATALOG, type ChatSession } from "../data/mockData"

export function useProjectSessions(assignedProjectIds: string[]) {
  const assignedProjects = PROJECT_CATALOG.filter((p) => assignedProjectIds.includes(p.id))

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => {
    return assignedProjects[0]?.id ?? null
  })

  const [sessions, setSessions] = useState<ChatSession[]>(() => [...INITIAL_SESSIONS])

  const [activeSessionId, setActiveSessionId] = useState<number | null>(() => {
    const firstProjId = assignedProjects[0]?.id
    if (!firstProjId) return null
    const scoped = INITIAL_SESSIONS.filter((s) => s.projectId === firstProjId).sort(
      (a, b) => a.projectOrder - b.projectOrder,
    )
    return scoped[0]?.id ?? null
  })

  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PROJECT_CATALOG.map((p) => [p.id, true])),
  )

  const currentProject = assignedProjects.find((p) => p.id === selectedProjectId) ?? null
  const activeSession = sessions.find(
    (s) => s.id === activeSessionId && s.projectId === selectedProjectId,
  )

  const createNewChat = (projectId: string | null = selectedProjectId) => {
    if (!projectId || !assignedProjectIds.includes(projectId)) return
    const newId = Date.now()
    setSessions((prev) => {
      const projectSessions = prev.filter((s) => s.projectId === projectId)
      const minOrder = projectSessions.length
        ? Math.min(...projectSessions.map((s) => s.projectOrder)) - 1
        : 1
      const newSession: ChatSession = {
        id: newId,
        projectId,
        title: `New chat #${projectSessions.length + 1}`,
        hasHistory: false,
        projectOrder: minOrder,
      }
      return [newSession, ...prev]
    })
    setActiveSessionId(newId)
  }

  const selectProject = (projectId: string) => {
    if (!assignedProjectIds.includes(projectId)) return
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

  const selectSession = (sessionId: number) => {
    const target = sessions.find((s) => s.id === sessionId)
    if (!target || !assignedProjectIds.includes(target.projectId)) return
    setSelectedProjectId(target.projectId)
    setActiveSessionId(target.id)
  }

  const renameSession = (sessionId: number) => {
    const target = sessions.find((s) => s.id === sessionId)
    if (!target) return
    const newTitle = window.prompt("Edit session title:", target.title)
    if (newTitle && newTitle.trim()) {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle.trim() } : s)),
      )
    }
  }

  const deleteSession = (sessionId: number) => {
    if (!window.confirm("Delete this chat session?")) return
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
  }

  return {
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
  }
}