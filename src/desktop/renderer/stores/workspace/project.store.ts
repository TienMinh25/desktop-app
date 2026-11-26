import type { ProjectsListResult, SessionRow } from "../../../../contracts/projects"
import { formatGeneralErrorMessage } from "../../utils/error-message"
import { toast } from "../app/toast.store"
import { createAppStore } from "../create-store"
import { useChatStore } from "./chat.store"

const PROJECT_ACTIONS = {
  LOADED: "projects/loaded",
  LOAD_FAILED: "projects/loadFailed",
  CREATE_CHAT: "projects/createChat",
  SELECT_PROJECT: "projects/selectProject",
  SELECT_SESSION: "projects/selectSession",
  TOGGLE_EXPAND: "projects/toggleExpand",
  RENAME_SESSION: "projects/renameSession",
  DELETE_SESSION: "projects/deleteSession",
  RESET: "projects/reset",
} as const

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

function toChatSession(row: SessionRow): ChatSession {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    hasHistory: false,
    updatedAt: row.updatedAt,
  }
}

export const newestFirst = (a: ChatSession, b: ChatSession) => b.updatedAt - a.updatedAt

interface ProjectStoreState {
  assignedProjects: ProjectItem[]
  loadError: string | null
  isLoaded: boolean
  selectedProjectId: string | null
  sessions: ChatSession[]
  activeSessionId: string | null
  expandedProjects: Record<string, boolean>

  initProjects: () => () => void
  selectProject: (projectId: string) => void
  toggleExpandProject: (projectId: string) => void
  selectSession: (sessionId: string) => void
  createNewChat: (projectId?: string | null) => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<boolean>
  reset: () => void
}

const INITIAL_PROJECT_STATE = {
  assignedProjects: [] as ProjectItem[],
  loadError: null as string | null,
  isLoaded: false,
  selectedProjectId: null as string | null,
  sessions: [] as ChatSession[],
  activeSessionId: null as string | null,
  expandedProjects: {} as Record<string, boolean>,
}

export const useProjectStore = createAppStore<ProjectStoreState>("ProjectStore", (set, get) => {
  const isAssigned = (projectId: string) =>
    get().assignedProjects.some((project) => project.id === projectId)

  const syncSessionHistory = (sessionId: string | null) => {
    void useChatStore.getState().loadHistory(sessionId)
  }

  return {
    ...INITIAL_PROJECT_STATE,

    initProjects: () => {
      let cancelled = false
      let firstChatCreated = false

      const apply = async ({ projects, syncedAt, error }: ProjectsListResult) => {
        if (projects.length === 0 && syncedAt === null && error === null) return
        const active = projects.filter((project) => project.isAssigned)
        const sessionLists = await Promise.all(
          active.map((project) => window.desktop.listSessions(project.id)),
        )
        if (cancelled) return

        if (!firstChatCreated && active[0] && sessionLists[0]?.length === 0) {
          firstChatCreated = true
          sessionLists[0] = [await window.desktop.createSession(active[0].id, "New chat #1")]
          if (cancelled) return
        }

        const sessions = sessionLists.flat().map(toChatSession)
        const firstProjectId = active[0]?.id ?? null
        const prevActiveSessionId = get().activeSessionId

        set(
          (state) => {
            const nextSelectedProjectId =
              state.selectedProjectId && active.some((p) => p.id === state.selectedProjectId)
                ? state.selectedProjectId
                : firstProjectId

            const activeStillAvailable = sessions.some(
              (s) => s.id === state.activeSessionId && s.projectId === nextSelectedProjectId,
            )
            const nextActiveSessionId = activeStillAvailable
              ? state.activeSessionId
              : (sessions.find((s) => s.projectId === nextSelectedProjectId)?.id ?? null)

            return {
              loadError: error,
              assignedProjects: active.map(({ id, key, name }) => ({ id, key, name })),
              expandedProjects: Object.fromEntries(
                active.map((project) => [project.id, state.expandedProjects[project.id] ?? true]),
              ),
              sessions,
              selectedProjectId: nextSelectedProjectId,
              activeSessionId: nextActiveSessionId,
              isLoaded: true,
            }
          },
          false,
          PROJECT_ACTIONS.LOADED,
        )
        const nextActiveSessionId = get().activeSessionId
        if (
          nextActiveSessionId !== prevActiveSessionId ||
          (nextActiveSessionId !== null &&
            useChatStore.getState().history[nextActiveSessionId] === undefined)
        ) {
          syncSessionHistory(nextActiveSessionId)
        }
      }

      const fail = (cause: unknown) => {
        if (cancelled) return
        set(
          {
            loadError: formatGeneralErrorMessage(cause, "Failed to load projects"),
            isLoaded: true,
          },
          false,
          PROJECT_ACTIONS.LOAD_FAILED,
        )
      }

      const unsubscribe = window.desktop.subscribeProjectsChanged((result) => {
        void apply(result).catch(fail)
      })
      void window.desktop.listProjects().then(apply).catch(fail)

      return () => {
        cancelled = true
        unsubscribe()
      }
    },

    createNewChat: async (projectId = get().selectedProjectId) => {
      if (!projectId || !isAssigned(projectId)) return
      const { activeSessionId, sessions } = get()
      const count = sessions.filter((s) => s.projectId === projectId).length
      try {
        const row = await window.desktop.createSession(projectId, `New chat #${count + 1}`)
        if (!isAssigned(projectId)) return
        const activate = get().selectedProjectId === projectId && get().activeSessionId === activeSessionId
        set(
          (state) => ({
            sessions: [toChatSession(row), ...state.sessions],
            activeSessionId: activate ? row.id : state.activeSessionId,
          }),
          false,
          PROJECT_ACTIONS.CREATE_CHAT,
        )
        if (activate) syncSessionHistory(row.id)
      } catch (cause) {
        toast.error(`Could not create chat: ${formatGeneralErrorMessage(cause)}`)
      }
    },

    selectProject: (projectId) => {
      if (!isAssigned(projectId)) return
      const newest = get()
        .sessions.filter((s) => s.projectId === projectId)
        .sort(newestFirst)[0]

      if (newest) {
        get().selectSession(newest.id)
      } else {
        set({ selectedProjectId: projectId, activeSessionId: null }, false, PROJECT_ACTIONS.SELECT_PROJECT)
        syncSessionHistory(null)
        void get().createNewChat(projectId)
      }
    },

    toggleExpandProject: (projectId) => {
      set(
        (state) => ({
          expandedProjects: {
            ...state.expandedProjects,
            [projectId]: !state.expandedProjects[projectId],
          },
        }),
        false,
        PROJECT_ACTIONS.TOGGLE_EXPAND,
      )
    },

    selectSession: (sessionId) => {
      const target = get().sessions.find((s) => s.id === sessionId)
      if (!target || !isAssigned(target.projectId)) return
      set(
        { selectedProjectId: target.projectId, activeSessionId: target.id },
        false,
        PROJECT_ACTIONS.SELECT_SESSION,
      )
      syncSessionHistory(target.id)
    },

    renameSession: async (sessionId, title) => {
      const newTitle = title.trim()
      if (!newTitle) return
      try {
        await window.desktop.renameSession(sessionId, newTitle)
        set(
          (state) => ({
            sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s)),
          }),
          false,
          PROJECT_ACTIONS.RENAME_SESSION,
        )
      } catch (cause) {
        toast.error(`Could not rename chat: ${formatGeneralErrorMessage(cause)}`)
      }
    },

    deleteSession: async (sessionId) => {
      if (!window.confirm("Delete this chat session?")) return false
      try {
        await window.desktop.deleteSession(sessionId)
      } catch (cause) {
        toast.error(`Could not delete chat: ${formatGeneralErrorMessage(cause)}`)
        return false
      }

      const { activeSessionId, selectedProjectId } = get()
      set((state) => {
        const remainingSessions = state.sessions.filter((s) => s.id !== sessionId)
        return {
          sessions: remainingSessions,
          activeSessionId: sessionId === state.activeSessionId
            ? (remainingSessions.filter((s) => s.projectId === state.selectedProjectId).sort(newestFirst)[0]?.id ?? null)
            : state.activeSessionId,
        }
      }, false, PROJECT_ACTIONS.DELETE_SESSION)
      const nextActiveSessionId = get().activeSessionId

      if (activeSessionId !== nextActiveSessionId) {
        syncSessionHistory(nextActiveSessionId)
        if (nextActiveSessionId === null && selectedProjectId) void get().createNewChat(selectedProjectId)
      }
      return true
    },

    reset: () => {
      set(INITIAL_PROJECT_STATE, false, PROJECT_ACTIONS.RESET)
      syncSessionHistory(null)
    },
  }
})
