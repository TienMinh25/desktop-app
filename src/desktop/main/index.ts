import { basename } from "node:path"
import { join } from "node:path"
import { mkdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { app, BrowserWindow, dialog, ipcMain, screen, shell, utilityProcess, type UtilityProcess } from "electron"
import electronUpdater from "electron-updater"
import { HARNESS_COMMAND_TYPES } from "../../contracts/message-types"
import { PermissionResponseCommandSchema, QuestionResponseCommandSchema } from "../../contracts/commands"
import type { HarnessEvent } from "../../contracts/events"
import { isHarnessCommand } from "../../contracts/guards"
import type { McpListServersParams } from "../../contracts/mcp-registry"
import type { AppUpdaterState } from "../../contracts/updater"
import type { LspServerConfig, LspSettings } from "../../contracts/lsp"
import { McpRegistryClient } from "../../domain/mcp-registry/mcp-registry-client"
import { LSP_SERVER_CATALOG } from "../../domain/lsp/lsp-registry"
import { LspSettingsStore } from "./lsp-settings-store"
import { IPC_CHANNELS } from "../constants/ipcChannels"

const { autoUpdater } = electronUpdater

let harnessProcess: UtilityProcess | null = null
let lspSettingsStore: LspSettingsStore | null = null
const mcpRegistryClient = new McpRegistryClient()

function getLspSettingsStore(): LspSettingsStore {
    if (!lspSettingsStore) throw new Error("LSP settings are not ready")
    return lspSettingsStore
}

function broadcastUpdaterState(state: AppUpdaterState) {
    for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.UPDATER_STATUS, state)
    }
}

function setupAutoUpdater() {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on("checking-for-update", () => {
        broadcastUpdaterState({ status: "checking" })
    })
    autoUpdater.on("update-available", (info) => {
        broadcastUpdaterState({
            status: "available",
            version: info.version,
            releaseDate: info.releaseDate,
        })
    })
    autoUpdater.on("update-not-available", (info) => {
        broadcastUpdaterState({
            status: "not-available",
            version: info?.version,
        })
    })
    autoUpdater.on("download-progress", (progress) => {
        broadcastUpdaterState({
            status: "downloading",
            percent: Math.round(progress.percent),
            transferred: progress.transferred,
            total: progress.total,
        })
    })
    autoUpdater.on("update-downloaded", (info) => {
        broadcastUpdaterState({
            status: "downloaded",
            version: info.version,
        })
    })
    autoUpdater.on("error", (err) => {
        broadcastUpdaterState({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
        })
    })
}

function startHarnessProcess(): UtilityProcess {
    const entryPath = fileURLToPath(new URL("./harness-server.js", import.meta.url))
    const process = utilityProcess.fork(entryPath, [], {
        serviceName: "Ccodex Harness",
    })
    harnessProcess = process
    process.on("message", (event: HarnessEvent) => {
        for (const window of BrowserWindow.getAllWindows()) {
            window.webContents.send(IPC_CHANNELS.HARNESS_EVENT, event)
        }
    })
    process.on("exit", () => {
        if (harnessProcess === process) harnessProcess = null
    })
    return process
}

function stopHarnessProcess() {
    const process = harnessProcess
    harnessProcess = null
    process?.kill()
}

function isCurrentHarnessProcess(candidate: UtilityProcess) {
    return harnessProcess === candidate
}

async function ensureHarnessProcess() {
    if (harnessProcess) return
    const process = startHarnessProcess()

    let initialLspServers: LspServerConfig[] = []
    try {
        initialLspServers = await getLspSettingsStore().harnessConfigs()
    } catch (error) {
        console.error("Could not load saved LSP settings; starting without language servers.", error)
    }
    if (isCurrentHarnessProcess(process)) {
        process.postMessage({ type: HARNESS_COMMAND_TYPES.LSP_CONFIGURE, servers: initialLspServers })
    }
}

function forwardHarnessCommand(command: unknown) {
    if (!harnessProcess) return
    harnessProcess.postMessage(command)
}

ipcMain.on(IPC_CHANNELS.HARNESS_COMMAND, (event, command: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender) || !isHarnessCommand(command) || command.type === HARNESS_COMMAND_TYPES.PERMISSION_RESPOND || command.type === HARNESS_COMMAND_TYPES.QUESTION_RESPOND || command.type === HARNESS_COMMAND_TYPES.LSP_CONFIGURE) return
    if (!harnessProcess) throw new Error("Harness process is not running")
    forwardHarnessCommand(command)
})
ipcMain.on(IPC_CHANNELS.PERMISSION_RESPONSE, (event, response: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return
    const payload = response && typeof response === "object" && !Array.isArray(response) ? response : {}
    const parsed = PermissionResponseCommandSchema.safeParse({ ...payload, type: HARNESS_COMMAND_TYPES.PERMISSION_RESPOND })
    if (!parsed.success) return
    forwardHarnessCommand(parsed.data)
})
ipcMain.on(IPC_CHANNELS.QUESTION_RESPONSE, (event, response: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return
    const payload = response && typeof response === "object" && !Array.isArray(response) ? response : {}
    const parsed = QuestionResponseCommandSchema.safeParse({ ...payload, type: HARNESS_COMMAND_TYPES.QUESTION_RESPOND })
    if (!parsed.success) return
    forwardHarnessCommand(parsed.data)
})


function createWindow() {
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize
    const width = Math.max(1100, Math.min(1440, Math.round(screenWidth * 0.8)))
    const height = Math.max(720, Math.min(920, Math.round(screenHeight * 0.85)))
    const window = new BrowserWindow({
        width,
        height,
        minWidth: 960,
        minHeight: 600,
        frame: false,
        title: "C-CodeX Desktop",
        autoHideMenuBar: true,
        backgroundColor: "#0c0c0d",
        webPreferences: {
            preload: fileURLToPath(new URL("../preload/index.cjs", import.meta.url)),
            contextIsolation: true,
            nodeIntegration: false,
        }
    })
    const rendererUrl = process.env.ELECTRON_RENDERER_URL
    if (rendererUrl) {
        void window.loadURL(rendererUrl)
        return
    }
    void window.loadFile(fileURLToPath(new URL("../renderer/index.html", import.meta.url)))
}
ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
})
ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) {
        win.unmaximize()
    } else {
        win.maximize()
    }
})
ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
})
ipcMain.handle(IPC_CHANNELS.SELECT_FOLDER, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = win
        ? await dialog.showOpenDialog(win, { properties: ["openDirectory"] })
        : await dialog.showOpenDialog({ properties: ["openDirectory"] })
    if (result.canceled || !result.filePaths[0]) {
        return null
    }
    const folderPath = result.filePaths[0]
    return {
        name: basename(folderPath) || folderPath,
        path: folderPath,
    }
})
ipcMain.handle(IPC_CHANNELS.MCP_LIST_SERVERS, async (_event, params?: McpListServersParams) => {
    return await mcpRegistryClient.listServers(params ?? {})
})
ipcMain.handle(
    IPC_CHANNELS.MCP_GET_SERVER_VERSION,
    async (_event, payload: { serverName: string; version?: string }) => {
        return await mcpRegistryClient.getServerVersion(payload.serverName, payload.version ?? "latest")
    },
)
ipcMain.handle(IPC_CHANNELS.LSP_LIST_SERVERS, async (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return []
    return await getLspSettingsStore().list()
})
ipcMain.handle(IPC_CHANNELS.LSP_RESCAN_SERVERS, async (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return []
    const statuses = await getLspSettingsStore().rescan()
    const servers = await getLspSettingsStore().harnessConfigs()
    forwardHarnessCommand({ type: HARNESS_COMMAND_TYPES.LSP_CONFIGURE, servers })
    return statuses
})
ipcMain.handle(IPC_CHANNELS.LSP_SAVE_SETTINGS, async (event, settings: LspSettings) => {
    if (!BrowserWindow.fromWebContents(event.sender)) throw new Error("Untrusted LSP settings request")
    const store = getLspSettingsStore()
    const statuses = await store.save(settings)
    const servers = await store.harnessConfigs()
    forwardHarnessCommand({ type: HARNESS_COMMAND_TYPES.LSP_CONFIGURE, servers })
    return statuses
})
ipcMain.handle(IPC_CHANNELS.LSP_OPEN_GUIDE, async (event, serverId: string) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return { opened: false }
    const server = LSP_SERVER_CATALOG.find((item) => item.id === serverId)
    if (!server) return { opened: false }
    await shell.openExternal(server.guideUrl)
    return { opened: true }
})
ipcMain.handle(IPC_CHANNELS.UPDATER_CHECK, async () => {
    if (!app.isPackaged) {
        return { status: "available", version: "1.2.0" } satisfies AppUpdaterState
    }
    const result = await autoUpdater.checkForUpdates()
    return {
        status: result?.updateInfo ? "available" : "not-available",
        version: result?.updateInfo?.version ?? app.getVersion(),
    } satisfies AppUpdaterState
})
ipcMain.handle(IPC_CHANNELS.UPDATER_START, async () => {
    if (!app.isPackaged) {
        broadcastUpdaterState({ status: "downloading", percent: 45, transferred: 38, total: 84 })
        setTimeout(() => {
            broadcastUpdaterState({ status: "downloaded", version: "1.2.0" })
        }, 600)
        return { started: true }
    }
    await autoUpdater.downloadUpdate()
    return { started: true }
})
ipcMain.on(IPC_CHANNELS.UPDATER_INSTALL, () => {
    if (app.isPackaged) {
        autoUpdater.quitAndInstall()
    }
})

app.whenReady().then(async () => {
    await mkdir(join(app.getPath("home"), ".ccodex"), { recursive: true })
    lspSettingsStore = new LspSettingsStore(app.getPath("userData"))
    setupAutoUpdater()
    await ensureHarnessProcess()
    createWindow()
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            void ensureHarnessProcess().then(createWindow)
        }
    })
})
app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        stopHarnessProcess()
        app.quit()
    }
})
app.on("before-quit", stopHarnessProcess)
