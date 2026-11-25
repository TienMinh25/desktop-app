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
  SET_SESSION_HISTORY: "projects/setSessionHasHistory",
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
  setSessionHasHistory: (sessionId: string, hasHistory: boolean) => void
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
    if (!sessionId) return
    void useChatStore.getState().loadHistory(sessionId).then((turns) => {
      if (turns && turns.length > 0) {
        get().setSessionHasHistory(sessionId, true)
      }
    })
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

        const loaded = sessionLists.flat().map(toChatSession)
        const firstProjectId = active[0]?.id ?? null
        const prevActiveSessionId = get().activeSessionId

        set(
          (state) => {
            const nextSelectedProjectId =
              state.selectedProjectId && active.some((p) => p.id === state.selectedProjectId)
                ? state.selectedProjectId
                : firstProjectId

            const nextActiveSessionId =
              state.activeSessionId && loaded.some((s) => s.id === state.activeSessionId)
                ? state.activeSessionId
                : (loaded.find((s) => s.projectId === firstProjectId)?.id ?? null)

            // Preserve loaded history flags across periodic background project syncs
            const previousHasHistory = new Map(state.sessions.map((s) => [s.id, s.hasHistory]))
            const sessions = loaded.map((session) =>
              previousHasHistory.get(session.id) ? { ...session, hasHistory: true } : session,
            )

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
          nextActiveSessionId &&
          (nextActiveSessionId !== prevActiveSessionId ||
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
      const count = get().sessions.filter((s) => s.projectId === projectId).length
      try {
        const row = await window.desktop.createSession(projectId, `New chat #${count + 1}`)
        set(
          (state) => ({
            sessions: [toChatSession(row), ...state.sessions],
            activeSessionId: row.id,
          }),
          false,
          PROJECT_ACTIONS.CREATE_CHAT,
        )
        syncSessionHistory(row.id)
      } catch (cause) {
        toast.error(`Could not create chat: ${formatGeneralErrorMessage(cause)}`)
      }
    },

    selectProject: (projectId) => {
      if (!isAssigned(projectId)) return
      set({ selectedProjectId: projectId }, false, PROJECT_ACTIONS.SELECT_PROJECT)
      const scoped = get()
        .sessions.filter((s) => s.projectId === projectId)
        .sort(newestFirst)

      if (scoped.length > 0 && scoped[0]) {
        set({ activeSessionId: scoped[0].id }, false, PROJECT_ACTIONS.SELECT_SESSION)
        syncSessionHistory(scoped[0].id)
      } else {
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

    setSessionHasHistory: (sessionId, hasHistory) => {
      set(
        (state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId && s.hasHistory !== hasHistory ? { ...s, hasHistory } : s,
          ),
        }),
        false,
        PROJECT_ACTIONS.SET_SESSION_HISTORY,
      )
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
      set(
        (state) => ({
          sessions: state.sessions.filter((s) => s.id !== sessionId),
        }),
        false,
        PROJECT_ACTIONS.DELETE_SESSION,
      )

      if (sessionId === activeSessionId && selectedProjectId) {
        const remaining = get()
          .sessions.filter((s) => s.id !== sessionId && s.projectId === selectedProjectId)
          .sort(newestFirst)[0]

        if (remaining) {
          set(
            (state) => ({
              activeSessionId: state.activeSessionId === sessionId ? remaining.id : state.activeSessionId,
            }),
            false,
            PROJECT_ACTIONS.SELECT_SESSION,
          )
          if (get().activeSessionId === remaining.id) syncSessionHistory(remaining.id)
        } else {
          void get().createNewChat(selectedProjectId)
        }
      }
      return true
    },

    reset: () => set(INITIAL_PROJECT_STATE, false, PROJECT_ACTIONS.RESET),
  }
})
