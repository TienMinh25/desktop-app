import type { ProjectsListResult, SessionRow } from "../../../../contracts/projects"
import { formatGeneralErrorMessage } from "../../utils/error-message"
import { toast } from "../app/toast.store"
import { createAppStore } from "../create-store"
import { QC_MOCK_SESSION_ID, useChatStore } from "./chat.store"
import { usePromptSettingsStore } from "./prompt-settings.store"

const PROJECT_ACTIONS = {
  LOADED: "projects/loaded",
  LOAD_FAILED: "projects/loadFailed",
  CREATE_CHAT: "projects/createChat",
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

  actions: {
    initProjects: () => () => void
    selectProject: (projectId: string) => void
    toggleExpandProject: (projectId: string) => void
    selectSession: (sessionId: string) => void
    createNewChat: (projectId?: string | null) => void
    createSessionForPrompt: (projectId: string, prompt: string) => Promise<string | null>
    renameSession: (sessionId: string, title: string) => Promise<void>
    deleteSession: (sessionId: string) => Promise<boolean>
    reset: () => void
  }
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
    void useChatStore.getState().actions.loadHistory(sessionId === QC_MOCK_SESSION_ID ? null : sessionId)
  }

  return {
    ...INITIAL_PROJECT_STATE,

    actions: {
      initProjects: () => {
      let cancelled = false

      const apply = async ({ projects, syncedAt, error }: ProjectsListResult) => {
        if (projects.length === 0 && syncedAt === null && error === null) return
        const active = projects.filter((project) => project.isAssigned)
        const sessionLists = await Promise.all(
          active.map((project) => window.desktop.listSessions(project.id)),
        )
        if (cancelled) return

        const loaded = sessionLists.flat().map(toChatSession)
        const firstProjectId = active[0]?.id ?? null

        const previousSessionId = get().activeSessionId
        if (firstProjectId) {
          loaded.push({
            id: QC_MOCK_SESSION_ID,
            projectId: firstProjectId,
            title: "[QC Mock] Queue, Stop & Question UI",
            hasHistory: true,
            updatedAt: 0,
          })
          useChatStore.getState().actions.initQcMockSession()
        }

        set(
          (state) => {
            const nextSelectedProjectId =
              state.selectedProjectId && active.some((p) => p.id === state.selectedProjectId)
                ? state.selectedProjectId
                : firstProjectId

            const nextActiveSessionId =
              state.activeSessionId && loaded.some((s) => s.id === state.activeSessionId && s.projectId === nextSelectedProjectId)
                ? state.activeSessionId
                : (loaded.find((s) => s.projectId === nextSelectedProjectId && s.id !== QC_MOCK_SESSION_ID)?.id ?? null)

            return {
              loadError: error,
              assignedProjects: active.map(({ id, key, name }) => ({ id, key, name })),
              expandedProjects: Object.fromEntries(
                active.map((project) => [project.id, state.expandedProjects[project.id] ?? false]),
              ),
              sessions: loaded,
              selectedProjectId: nextSelectedProjectId,
              activeSessionId: nextActiveSessionId,
              isLoaded: true,
            }
          },
          false,
          PROJECT_ACTIONS.LOADED,
        )
        const selected = get().activeSessionId
        if (selected !== previousSessionId ||
          (selected && selected !== QC_MOCK_SESSION_ID && useChatStore.getState().history[selected] === undefined)) {
          syncSessionHistory(selected)
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

    createNewChat: (projectId = get().selectedProjectId) => {
      if (!projectId || !isAssigned(projectId)) return
      usePromptSettingsStore.getState().actions.clearSelectedFolder()
      set(
        { selectedProjectId: projectId, activeSessionId: null },
        false,
        PROJECT_ACTIONS.CREATE_CHAT,
      )
      syncSessionHistory(null)
    },

    createSessionForPrompt: async (projectId, prompt) => {
      if (!projectId || !isAssigned(projectId)) return null
      const previousSessionId = get().activeSessionId
      const count = get().sessions.filter((s) => s.projectId === projectId && s.id !== QC_MOCK_SESSION_ID).length
      const title = prompt.trim().replace(/\s+/g, " ").slice(0, 120) || `New chat #${count + 1}`
      try {
        const row = await window.desktop.createSession(projectId, title)
        if (!isAssigned(projectId)) return null
        set(
          (state) => ({
            sessions: [toChatSession(row), ...state.sessions],
            activeSessionId: state.selectedProjectId === projectId && state.activeSessionId === previousSessionId
              ? row.id : state.activeSessionId,
            expandedProjects: { ...state.expandedProjects, [projectId]: true },
          }),
          false,
          PROJECT_ACTIONS.CREATE_CHAT,
        )
        if (get().activeSessionId === row.id) syncSessionHistory(row.id)
        return row.id
      } catch (cause) {
        toast.error(`Could not create chat: ${formatGeneralErrorMessage(cause)}`)
        return null
      }
    },

    selectProject: (projectId) => {
      if (!isAssigned(projectId)) return
      const scoped = get()
        .sessions.filter((s) => s.projectId === projectId && s.id !== QC_MOCK_SESSION_ID)
        .sort(newestFirst)

      if (scoped.length > 0 && scoped[0]) {
        get().actions.selectSession(scoped[0].id)
      } else {
        get().actions.createNewChat(projectId)
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
        if (sessionId !== QC_MOCK_SESSION_ID) {
          await window.desktop.renameSession(sessionId, newTitle)
        }
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
      try {
        if (sessionId !== QC_MOCK_SESSION_ID) {
          await window.desktop.deleteSession(sessionId)
        }
      } catch (cause) {
        toast.error(`Could not delete chat: ${formatGeneralErrorMessage(cause)}`)
        return false
      }

      const previousSessionId = get().activeSessionId
      set((state) => {
        const sessions = state.sessions.filter((s) => s.id !== sessionId)
        return {
          sessions,
          activeSessionId: state.activeSessionId === sessionId
            ? (sessions.filter((s) => s.projectId === state.selectedProjectId && s.id !== QC_MOCK_SESSION_ID).sort(newestFirst)[0]?.id ?? null)
            : state.activeSessionId,
        }
      }, false, PROJECT_ACTIONS.DELETE_SESSION)
      const selected = get().activeSessionId
      if (selected !== previousSessionId) syncSessionHistory(selected)
      return true
    },

    reset: () => {
      set(INITIAL_PROJECT_STATE, false, PROJECT_ACTIONS.RESET)
      syncSessionHistory(null)
    },
    },
  }
})
