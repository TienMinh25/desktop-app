/// <reference types="vite/client" />
import type { HarnessCommand } from "../../contracts/commands"
import type { HarnessEvent } from "../../contracts/events"
import type { McpConnectorItem, McpListServersParams, McpListServersResponse } from "../../contracts/mcp-registry"
import type { AppUpdaterState } from "../../contracts/updater"
import type { LspServerStatus, LspSettings } from "../../contracts/lsp"
import type { AuthState } from "../../contracts/auth"

declare global {
  interface SelectedFolderInfo {
    name: string
    path: string
  }

  interface DesktopBridge {
    platform?: string
    minimizeWindow: () => void
    maximizeWindow: () => void
    closeWindow: () => void
    selectFolder: () => Promise<SelectedFolderInfo | null>
    getAuthState: () => Promise<AuthState>
    login: (username: string, password: string) => Promise<AuthState>
    logout: () => Promise<{ remoteLogoutSucceeded: boolean }>
    subscribeAuthState: (listener: (state: AuthState) => void) => () => void
    listMcpServers: (params?: McpListServersParams) => Promise<McpListServersResponse>
    getMcpServerVersion: (serverName: string, version?: string) => Promise<McpConnectorItem>
    listLspServers: () => Promise<LspServerStatus[]>
    rescanLspServers: () => Promise<LspServerStatus[]>
    saveLspSettings: (settings: LspSettings) => Promise<LspServerStatus[]>
    openLspGuide: (serverId: string) => Promise<{ opened: boolean }>
    checkForUpdates: () => Promise<AppUpdaterState>
    startUpdateDownload: () => Promise<{ started: boolean }>
    installDownloadedUpdate: () => void
    subscribeUpdaterStatus: (listener: (state: AppUpdaterState) => void) => () => void
    sendHarnessCommand: (command: HarnessCommand) => void
    respondToPermission: (permissionRequestId: string, decision: "allow" | "deny") => void
    respondToQuestion: (questionRequestId: string, answer: string) => void
    subscribeHarnessEvents: (listener: (event: HarnessEvent) => void) => () => void
  }

  interface Window {
    desktop: DesktopBridge
    showDirectoryPicker?: () => Promise<{ name: string }>
  }
}

export {}
