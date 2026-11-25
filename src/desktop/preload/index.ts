import { contextBridge, ipcRenderer } from "electron"
import type { HarnessCommand } from "../../contracts/commands"
import type { HarnessEvent } from "../../contracts/events"
import type { McpConnectorItem, McpListServersParams, McpListServersResponse } from "../../contracts/mcp-registry"
import type { AppUpdaterState } from "../../contracts/updater"
import type { LspServerStatus, LspSettings } from "../../contracts/lsp"
import type { AuthState } from "../../contracts/auth"
import { IPC_CHANNELS } from "../constants/ipcChannels"
import type { ProjectsListResult, SessionRow, SidebarSearchResult } from "../../contracts/projects"
import type { OpenMediaPathResult, SessionHistoryTurn } from "../../contracts/session-history"

async function invokeChannel<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("ccodex:ipc-error", {
          detail: { channel, message },
        }),
      )
    }
    throw error
  }
}

contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform,
  minimizeWindow: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE),
  maximizeWindow: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MAXIMIZE),
  closeWindow: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE),
  selectFolder: (): Promise<{ name: string; path: string } | null> =>
    invokeChannel(IPC_CHANNELS.SELECT_FOLDER),
  getAuthState: (): Promise<AuthState> => invokeChannel(IPC_CHANNELS.AUTH_GET_STATE),
  login: (username: string, password: string): Promise<AuthState> =>
    invokeChannel(IPC_CHANNELS.AUTH_LOGIN, { username, password }),
  logout: (): Promise<{ remoteLogoutSucceeded: boolean }> =>
    invokeChannel(IPC_CHANNELS.AUTH_LOGOUT),
  subscribeAuthState: (listener: (state: AuthState) => void): (() => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, state: AuthState) => listener(state)
    ipcRenderer.on(IPC_CHANNELS.AUTH_STATE, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AUTH_STATE, handler)
  },
  listMcpServers: (params?: McpListServersParams): Promise<McpListServersResponse> =>
    invokeChannel(IPC_CHANNELS.MCP_LIST_SERVERS, params),
  getMcpServerVersion: (serverName: string, version?: string): Promise<McpConnectorItem> =>
    invokeChannel(IPC_CHANNELS.MCP_GET_SERVER_VERSION, { serverName, version }),
  listLspServers: (): Promise<LspServerStatus[]> =>
    invokeChannel(IPC_CHANNELS.LSP_LIST_SERVERS),
  rescanLspServers: (): Promise<LspServerStatus[]> =>
    invokeChannel(IPC_CHANNELS.LSP_RESCAN_SERVERS),
  saveLspSettings: (settings: LspSettings): Promise<LspServerStatus[]> =>
    invokeChannel(IPC_CHANNELS.LSP_SAVE_SETTINGS, settings),
  openLspGuide: (serverId: string): Promise<{ opened: boolean }> =>
    invokeChannel(IPC_CHANNELS.LSP_OPEN_GUIDE, serverId),
  checkForUpdates: (): Promise<AppUpdaterState> =>
    invokeChannel(IPC_CHANNELS.UPDATER_CHECK),
  startUpdateDownload: (): Promise<{ started: boolean }> =>
    invokeChannel(IPC_CHANNELS.UPDATER_START),
  installDownloadedUpdate: (): void =>
    ipcRenderer.send(IPC_CHANNELS.UPDATER_INSTALL),
  subscribeUpdaterStatus: (listener: (state: AppUpdaterState) => void): (() => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, state: AppUpdaterState) => listener(state)
    ipcRenderer.on(IPC_CHANNELS.UPDATER_STATUS, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATER_STATUS, handler)
  },
  sendHarnessCommand: (command: HarnessCommand): void =>
    ipcRenderer.send(IPC_CHANNELS.HARNESS_COMMAND, command),
  respondToPermission: (permissionRequestId: string, decision: "allow" | "deny"): void =>
    ipcRenderer.send(IPC_CHANNELS.PERMISSION_RESPONSE, { permissionRequestId, decision }),
  respondToQuestion: (questionRequestId: string, answer: string): void =>
    ipcRenderer.send(IPC_CHANNELS.QUESTION_RESPONSE, { questionRequestId, answer }),
  listProjects: (): Promise<ProjectsListResult> =>
    invokeChannel(IPC_CHANNELS.PROJECTS_LIST),
  listSessions: (projectId: string): Promise<SessionRow[]> =>
    invokeChannel(IPC_CHANNELS.SESSIONS_LIST, projectId),
  createSession: (projectId: string, title: string): Promise<SessionRow> =>
    invokeChannel(IPC_CHANNELS.SESSIONS_CREATE, projectId, title),
  renameSession: (sessionId: string, title: string): Promise<void> =>
    invokeChannel(IPC_CHANNELS.SESSIONS_RENAME, sessionId, title),
  deleteSession: (sessionId: string): Promise<void> =>
    invokeChannel(IPC_CHANNELS.SESSIONS_DELETE, sessionId),
  listSessionHistory: (sessionId: string): Promise<SessionHistoryTurn[]> =>
    invokeChannel(IPC_CHANNELS.SESSIONS_HISTORY, sessionId),
  openMediaPath: (filePath: string): Promise<OpenMediaPathResult> =>
    invokeChannel(IPC_CHANNELS.MEDIA_OPEN_PATH, filePath),
  searchSidebar: (query: string): Promise<SidebarSearchResult> =>
    invokeChannel(IPC_CHANNELS.SIDEBAR_SEARCH, query),
  subscribeProjectsChanged: (listener: (result: ProjectsListResult) => void): (() => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, result: ProjectsListResult) => listener(result)
    ipcRenderer.on(IPC_CHANNELS.PROJECTS_CHANGED, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PROJECTS_CHANGED, handler)
  },
  subscribeHarnessEvents: (listener: (event: HarnessEvent) => void): (() => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, event: HarnessEvent) => listener(event)
    ipcRenderer.on(IPC_CHANNELS.HARNESS_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.HARNESS_EVENT, handler)
  },
  subscribeLogEvents: (
    listener: (entry: {
      category: "api" | "ipc"
      level: "info" | "error"
      env: string
      message: string
      meta?: unknown
    }) => void,
  ): (() => void) => {
    const handler = (
      _ipcEvent: Electron.IpcRendererEvent,
      entry: {
        category: "api" | "ipc"
        level: "info" | "error"
        env: string
        message: string
        meta?: unknown
      },
    ) => listener(entry)
    ipcRenderer.on(IPC_CHANNELS.APP_LOG_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.APP_LOG_EVENT, handler)
  },
})
