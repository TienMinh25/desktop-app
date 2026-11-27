import { basename } from "node:path"
import { join } from "node:path"
import { mkdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { app, BrowserWindow, dialog, ipcMain, protocol, screen, shell, utilityProcess, type UtilityProcess } from "electron"
import electronUpdater from "electron-updater"
import { HARNESS_COMMAND_TYPES, HARNESS_EVENT_TYPES } from "../../contracts/message-types"
import { PermissionResponseCommandSchema, QuestionResponseCommandSchema, type HarnessCommand } from "../../contracts/commands"
import type { HarnessEvent } from "../../contracts/events"
import { isHarnessCommand } from "../../contracts/guards"
import type { McpListServersParams } from "../../contracts/mcp-registry"
import type { AppUpdaterState } from "../../contracts/updater"
import type { LspServerConfig, LspSettings } from "../../contracts/lsp"
import { AuthCredentialsSchema, AuthRpcRequestSchema, type AuthRpcRequest, type AuthRpcResponse, type AuthState } from "../../contracts/auth"
import { McpRegistryClient } from "../../domain/mcp-registry/mcp-registry-client"
import { validate } from "../../infrastructure/config/environment"
import { LSP_SERVER_CATALOG } from "../../domain/lsp/lsp-registry"
import { LspSettingsStore } from "./lsp-settings-store"
import { HarnessLifecycle } from "./harness-lifecycle"
import { IPC_CHANNELS } from "../constants/ipcChannels"
import { AuthService, AuthServiceError } from "./auth-service"
import { AuthSessionStore } from "./auth-session-store"
import { getSystemDispatcher } from "../../infrastructure/http/system-ca"
import { BackendHttpClient } from "../../infrastructure/http/backend-http-client"
import { registerIpcHandler, setLogForwarder, type ForwardedLogEntry } from "../../infrastructure/logging/logger"
import { createSession, deleteSession, listProjects, listSessions, renameSession, searchSidebar, syncProjects } from "./project-session-store"
import { MEDIA_PROTOCOL_SCHEME, openAllowedMediaPath, parseMediaProtocolUrl, readReferencedMediaBlob } from "./media-store"
import { listSessionHistory } from "./message-store"
import { migrate, openDb, type Db } from "../../infrastructure/db/sqlite"
import { fetchProjects } from "../../domain/projects/projects-client"
import type { ProjectsListResult } from "../../contracts/projects"

getSystemDispatcher()

const MAX_LOGS_PER_CATEGORY = 300
const logHistory: ForwardedLogEntry[] = []

function appendBoundedLog<T extends { category: "api" | "ipc" }>(list: T[], entry: T): T[] {
    let categoryCount = 0
    const next: T[] = [entry]
    categoryCount += 1
    for (const item of list) {
        if (item.category === entry.category) {
            if (categoryCount >= MAX_LOGS_PER_CATEGORY) continue
            categoryCount += 1
        }
        next.push(item)
    }
    return next
}

setLogForwarder((entry) => {
    const updated = appendBoundedLog(logHistory, entry)
    logHistory.splice(0, logHistory.length, ...updated)
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
            win.webContents.send(IPC_CHANNELS.APP_LOG_EVENT, entry)
        }
    }
})

const { autoUpdater } = electronUpdater

const HARNESS_READY_TIMEOUT_MS = 15_000
const HARNESS_STOP_TIMEOUT_MS = 5_000

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
    app.quit()
} else {
    app.on("second-instance", () => {
        if (quitState !== "running") return
        const existingWindow = BrowserWindow.getAllWindows()[0]
        if (!existingWindow) {
            if (db) void openMainWindow()
            return
        }
        if (existingWindow.isMinimized()) existingWindow.restore()
        existingWindow.focus()
    })
}

const ccodexDirectory = join(app.getPath("home"), ".ccodex")
let quitState: "running" | "stopping" | "finished" = "running"
const harness = new HarnessLifecycle({
    fork: forkHarnessProcess,
    configure: configureHarness,
    onMessage(child, message) {
        const request = AuthRpcRequestSchema.safeParse(message)
        if (request.success) {
            void handleHarnessAuthRequest(child, request.data)
            return
        }
        broadcastHarnessEvent(message as HarnessEvent)
    },
    onUnexpectedExit() {
        broadcastHarnessEvent({ type: HARNESS_EVENT_TYPES.HARNESS_EXITED })
    },
    readyTimeoutMs: HARNESS_READY_TIMEOUT_MS,
    stopTimeoutMs: HARNESS_STOP_TIMEOUT_MS,
})
let logWindow: BrowserWindow | null = null
let lspSettingsStore: LspSettingsStore | null = null
let authService: AuthService | null = null
const envConfig = validate(process.env)
const mcpRegistryClient = new McpRegistryClient({
    baseUrl: envConfig.MCP_REGISTRY_BASE_URL,
    apiVersion: envConfig.MCP_REGISTRY_API_VERSION,
})

function getLspSettingsStore(): LspSettingsStore {
    if (!lspSettingsStore) throw new Error("LSP settings are not ready")
    return lspSettingsStore
}

function getAuthService(): AuthService {
    if (!authService) throw new Error("Authentication service is not ready")
    return authService
}

function isTrustedAuthSender(event: Electron.IpcMainInvokeEvent): boolean {
    if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame) return false
    if (process.env.ELECTRON_RENDERER_URL) {
        try {
            return new URL(event.senderFrame.url).origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
        } catch {
            return false
        }
    }
    return event.senderFrame.url === new URL("../renderer/index.html", import.meta.url).href
}

function broadcastAuthState(state: AuthState) {
    for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.AUTH_STATE, state)
    }
}

async function handleHarnessAuthRequest(child: UtilityProcess, request: AuthRpcRequest) {
    try {
        let response: AuthRpcResponse
        switch (request.type) {
            case "auth.rpc.get-access-token":
                response = {
                    type: "auth.rpc.access-token",
                    requestId: request.requestId,
                    accessToken: await getAuthService().getAccessToken(),
                }
                break
            case "auth.rpc.refresh":
                response = {
                    type: "auth.rpc.access-token",
                    requestId: request.requestId,
                    accessToken: await getAuthService().refreshAccessToken(),
                }
                break
            case "auth.rpc.expire-session":
                await getAuthService().expireSession()
                response = { type: "auth.rpc.result", requestId: request.requestId }
                break
            default:
                return assertNever(request)
        }
        if (harness.readyProcess === child) child.postMessage(response)
    } catch (error) {
        if (error instanceof AuthServiceError && error.code === "unauthenticated") {
            broadcastAuthState({ authenticated: false, username: null })
        }
        if (harness.readyProcess === child) {
            child.postMessage({
                type: "auth.rpc.error",
                requestId: request.requestId,
                code: error instanceof AuthServiceError && error.code === "unauthenticated"
                    ? "unauthenticated"
                    : "request-failed",
                message: error instanceof Error ? error.message : "Authentication request failed",
            } satisfies AuthRpcResponse)
        }
    }
}

let db: Db | null = null
let projectsHttp: BackendHttpClient | null = null

function getDb(): Db {
    if (!db) throw new Error("Database is not ready")
    return db
}

function closeDb() {
    db?.close()
    db = null
}

// Project assignments change rarely: sync when the workspace opens (projects:list, after login or restore) and every 10 min
// Random extra delay spreads 1500 clients that start at the same time
const PROJECT_SYNC_INTERVAL_MS = 10 * 60_000
const PROJECT_SYNC_JITTER_MS = 60_000
let projectSync: { syncedAt: number | null; error: string | null } = { syncedAt: null, error: null }
let projectSyncRun: Promise<void> | null = null
let projectSyncTimer: NodeJS.Timeout | null = null

function syncProjectsInBackground(): Promise<void> {
    return projectSyncRun ??= (async () => {
        try {
            // Signed out is not a sync error, the next login triggers a sync
            if (!(await getAuthService().getAuthState()).authenticated) return
            syncProjects(getDb(), await fetchProjects(getProjectsHttp()))
            projectSync = { syncedAt: Date.now(), error: null }
        } catch (cause) {
            projectSync = { ...projectSync, error: cause instanceof Error ? cause.message : String(cause) }
        } finally {
            projectSyncRun = null
        }
        // The DB is closed when a sync finishes during quit
        if (db) broadcastProjects()
    })()
}

function scheduleProjectSync() {
    // No new round after quit closed the DB
    if (!db || quitState !== "running") return
    projectSyncTimer = setTimeout(() => {
        void syncProjectsInBackground().finally(scheduleProjectSync)
    }, PROJECT_SYNC_INTERVAL_MS + Math.random() * PROJECT_SYNC_JITTER_MS)
}

function getProjectsHttp(): BackendHttpClient {
    if (!projectsHttp) throw new Error("Projects client is not ready")
    return projectsHttp
}

function projectsListResult(): ProjectsListResult {
    return { projects: listProjects(getDb()), ...projectSync }
}

function broadcastProjects() {
    const result = projectsListResult()
    for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.PROJECTS_CHANGED, result)
    }
}

function requireTrustedSender(event: Electron.IpcMainInvokeEvent) {
    if (!isTrustedAuthSender(event)) throw new Error("Untrusted IPC sender")
}

// Returns the cached list at once, the fresh list arrives as projects:changed
registerIpcHandler(ipcMain, IPC_CHANNELS.PROJECTS_LIST, async (event) => {
    requireTrustedSender(event)
    void syncProjectsInBackground()
    return projectsListResult()
})
registerIpcHandler(ipcMain, IPC_CHANNELS.SESSIONS_LIST, async (event, projectId: unknown) => {
    requireTrustedSender(event)
    return listSessions(getDb(), requireText(projectId, "projectId"))
})
registerIpcHandler(ipcMain, IPC_CHANNELS.SESSIONS_CREATE, async (event, projectId: unknown, title: unknown) => {
    requireTrustedSender(event)
    return createSession(getDb(), requireText(projectId, "projectId"), app.getPath("home"), requireText(title, "title"))
})
registerIpcHandler(ipcMain, IPC_CHANNELS.SESSIONS_RENAME, async (event, sessionId: unknown, title: unknown) => {
    requireTrustedSender(event)
    renameSession(getDb(), requireText(sessionId, "sessionId"), requireText(title, "title"))
})
registerIpcHandler(ipcMain, IPC_CHANNELS.SESSIONS_DELETE, async (event, sessionId: unknown) => {
    requireTrustedSender(event)
    deleteSession(getDb(), requireText(sessionId, "sessionId"), { harnessAlive: harness.alive })
})
ipcMain.handle(IPC_CHANNELS.SESSIONS_HISTORY, async (event, sessionId: unknown) => {
    requireTrustedSender(event)
    return listSessionHistory(getDb(), requireText(sessionId, "sessionId"))
})
ipcMain.handle(IPC_CHANNELS.MEDIA_OPEN_PATH, async (event, filePath: unknown) => {
    requireTrustedSender(event)
    return openAllowedMediaPath(getDb(), filePath, (targetPath) => shell.openPath(targetPath))
})
registerIpcHandler(ipcMain, IPC_CHANNELS.SIDEBAR_SEARCH, async (event, query: unknown) => {
    requireTrustedSender(event)
    return searchSidebar(getDb(), requireText(query, "query"))
})
registerIpcHandler(ipcMain, IPC_CHANNELS.DEBUG_OPEN_LOG_WINDOW, async (event) => {
    requireTrustedSender(event)
    openLogWindow()
})
registerIpcHandler(ipcMain, IPC_CHANNELS.DEBUG_GET_LOG_HISTORY, async (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) throw new Error("Untrusted IPC sender")
    return logHistory
})
registerIpcHandler(ipcMain, IPC_CHANNELS.DEBUG_CLEAR_LOGS, async (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) throw new Error("Untrusted IPC sender")
    logHistory.length = 0
})

// Reject blank renderer input before calling the stores
function requireText(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`)
    return value.trim()
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

function broadcastHarnessEvent(event: HarnessEvent) {
    for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
            window.webContents.send(IPC_CHANNELS.HARNESS_EVENT, event)
        }
    }
}

function forkHarnessProcess(): UtilityProcess {
    if (quitState !== "running") throw new Error("The app is shutting down.")
    const entryPath = fileURLToPath(new URL("./harness-server.js", import.meta.url))
    return utilityProcess.fork(entryPath, [], {
        serviceName: "Ccodex Harness",
        env: { ...process.env, CCODEX_DB_PATH: join(ccodexDirectory, "ccodex.db") },
    })
}

async function configureHarness(child: UtilityProcess) {
    let servers: LspServerConfig[] = []
    try {
        servers = await getLspSettingsStore().harnessConfigs()
    } catch (error) {
        console.error("Could not load saved LSP settings; starting without language servers.", error)
    }
    child.postMessage({ type: HARNESS_COMMAND_TYPES.LSP_CONFIGURE, servers })
}

function forwardHarnessCommand(command: HarnessCommand): boolean {
    const child = harness.readyProcess
    if (!child || quitState !== "running") return false
    child.postMessage(command)
    return true
}

ipcMain.on(IPC_CHANNELS.HARNESS_COMMAND, (event, command: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender) || !isHarnessCommand(command) || command.type === HARNESS_COMMAND_TYPES.PERMISSION_RESPOND || command.type === HARNESS_COMMAND_TYPES.QUESTION_RESPOND || command.type === HARNESS_COMMAND_TYPES.LSP_CONFIGURE) return
    if (forwardHarnessCommand(command) || command.type !== HARNESS_COMMAND_TYPES.CHAT_SUBMIT || quitState !== "running") return
    void harness.ensure().then((child) => {
        if (quitState !== "running") return
        if (harness.readyProcess !== child) throw new Error("Harness exited before accepting the prompt.")
        child.postMessage(command)
    }).catch((error: unknown) => {
        if (quitState !== "running") return
        console.error("Could not send prompt to the harness:", error)
        broadcastHarnessEvent({
            type: HARNESS_EVENT_TYPES.CHAT_FAILED,
            requestId: command.requestId,
            sessionId: command.sessionId,
            prompt: command.prompt,
            message: "The assistant harness is unavailable. Try again.",
        })
    })
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


// The window opens even when the harness fails, a prompt then retries the start and reports the error
async function openMainWindow() {
    try {
        await harness.ensure()
    } catch (error) {
        console.error("Could not start the harness:", error)
    }
    if (quitState !== "running") return
    const existingWindow = BrowserWindow.getAllWindows()[0]
    if (existingWindow) {
        if (existingWindow.isMinimized()) existingWindow.restore()
        existingWindow.focus()
        return
    }
    createWindow()
}

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
    window.on("closed", () => {
        if (logWindow && !logWindow.isDestroyed()) {
            logWindow.close()
        }
    })
    window.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("http:") || url.startsWith("https:") || url.startsWith("mailto:")) {
            void shell.openExternal(url)
        }
        return { action: "deny" }
    })
    const rendererUrl = process.env.ELECTRON_RENDERER_URL
    if (rendererUrl) {
        void window.loadURL(rendererUrl)
        return
    }
    void window.loadFile(fileURLToPath(new URL("../renderer/index.html", import.meta.url)))
}

function openLogWindow() {
    if (envConfig.APP_ENV === "prod") return
    if (logWindow && !logWindow.isDestroyed()) {
        if (logWindow.isMinimized()) logWindow.restore()
        logWindow.focus()
        return
    }
    const child = new BrowserWindow({
        width: 980,
        height: 700,
        minWidth: 720,
        minHeight: 480,
        title: "C-CodeX Runtime Debug Logs",
        autoHideMenuBar: true,
        backgroundColor: "#0c0c0d",
        webPreferences: {
            preload: fileURLToPath(new URL("../preload/index.cjs", import.meta.url)),
            contextIsolation: true,
            nodeIntegration: false,
        },
    })
    logWindow = child
    child.on("closed", () => {
        if (logWindow === child) logWindow = null
    })
    const rendererUrl = process.env.ELECTRON_RENDERER_URL
    if (rendererUrl) {
        const url = new URL(rendererUrl)
        url.searchParams.set("view", "logs")
        void child.loadURL(url.toString())
        return
    }
    void child.loadFile(fileURLToPath(new URL("../renderer/index.html", import.meta.url)), {
        query: { view: "logs" },
    })
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
registerIpcHandler(ipcMain, IPC_CHANNELS.SELECT_FOLDER, async (event) => {
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
registerIpcHandler(ipcMain, IPC_CHANNELS.AUTH_GET_STATE, async (event) => {
    if (!isTrustedAuthSender(event)) throw new Error("Untrusted authentication request")
    return await getAuthService().getAuthState()
})
registerIpcHandler(ipcMain, IPC_CHANNELS.AUTH_LOGIN, async (event, value: unknown) => {
    if (!isTrustedAuthSender(event)) throw new Error("Untrusted authentication request")
    const parsed = AuthCredentialsSchema.safeParse(value)
    if (!parsed.success) throw new Error("Username and password are required")
    const state = await getAuthService().login(parsed.data.username, parsed.data.password)
    broadcastAuthState(state)
    return state
}, { logArgs: false })
registerIpcHandler(ipcMain, IPC_CHANNELS.AUTH_LOGOUT, async (event) => {
    if (!isTrustedAuthSender(event)) throw new Error("Untrusted authentication request")
    return await getAuthService().logout()
})
registerIpcHandler(ipcMain, IPC_CHANNELS.MCP_LIST_SERVERS, async (_event, params?: McpListServersParams) => {
    return await mcpRegistryClient.listServers(params ?? {})
})
registerIpcHandler(
    ipcMain,
    IPC_CHANNELS.MCP_GET_SERVER_VERSION,
    async (_event, payload: { serverName: string; version?: string }) => {
        return await mcpRegistryClient.getServerVersion(payload.serverName, payload.version ?? "latest")
    },
)
registerIpcHandler(ipcMain, IPC_CHANNELS.LSP_LIST_SERVERS, async (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return []
    return await getLspSettingsStore().list()
})
registerIpcHandler(ipcMain, IPC_CHANNELS.LSP_RESCAN_SERVERS, async (event) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return []
    const statuses = await getLspSettingsStore().rescan()
    const servers = await getLspSettingsStore().harnessConfigs()
    forwardHarnessCommand({ type: HARNESS_COMMAND_TYPES.LSP_CONFIGURE, servers })
    return statuses
})
registerIpcHandler(ipcMain, IPC_CHANNELS.LSP_SAVE_SETTINGS, async (event, settings: LspSettings) => {
    if (!BrowserWindow.fromWebContents(event.sender)) throw new Error("Untrusted LSP settings request")
    const store = getLspSettingsStore()
    const statuses = await store.save(settings)
    const servers = await store.harnessConfigs()
    forwardHarnessCommand({ type: HARNESS_COMMAND_TYPES.LSP_CONFIGURE, servers })
    return statuses
})
registerIpcHandler(ipcMain, IPC_CHANNELS.LSP_OPEN_GUIDE, async (event, serverId: string) => {
    if (!BrowserWindow.fromWebContents(event.sender)) return { opened: false }
    const server = LSP_SERVER_CATALOG.find((item) => item.id === serverId)
    if (!server) return { opened: false }
    await shell.openExternal(server.guideUrl)
    return { opened: true }
})
registerIpcHandler(ipcMain, IPC_CHANNELS.UPDATER_CHECK, async () => {
    if (!app.isPackaged) {
        return { status: "available", version: "1.2.0" } satisfies AppUpdaterState
    }
    const result = await autoUpdater.checkForUpdates()
    return {
        status: result?.updateInfo ? "available" : "not-available",
        version: result?.updateInfo?.version ?? app.getVersion(),
    } satisfies AppUpdaterState
})
registerIpcHandler(ipcMain, IPC_CHANNELS.UPDATER_START, async () => {
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

// Custom media protocol privileges must be registered before app readiness
protocol.registerSchemesAsPrivileged([
    {
        scheme: MEDIA_PROTOCOL_SCHEME,
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            stream: true,
        },
    },
])

app.whenReady().then(async () => {
    if (!hasSingleInstanceLock || quitState !== "running") return
    await mkdir(ccodexDirectory, { recursive: true })
    if (quitState !== "running") return
    lspSettingsStore = new LspSettingsStore(ccodexDirectory, process.env, process.platform, app.getPath("home"))
    authService = new AuthService(
        new AuthSessionStore(ccodexDirectory),
        () => broadcastAuthState({ authenticated: false, username: null }),
        envConfig.BACKEND_HOST,
    )
    projectsHttp = new BackendHttpClient(envConfig.BACKEND_HOST, authService)
    try {
        db = openDb(ccodexDirectory)
        migrate(db, join(ccodexDirectory, "backups"))
    } catch (error) {
        dialog.showErrorBox("Cannot open local data", error instanceof Error ? error.message : String(error))
        app.quit()
        return
    }
    protocol.handle(MEDIA_PROTOCOL_SCHEME, (request) => {
        if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 })
        if (!db) return new Response(null, { status: 503 })
        const sha256 = parseMediaProtocolUrl(request.url)
        if (!sha256) return new Response(null, { status: 404 })
        const blob = readReferencedMediaBlob(db, sha256)
        if (!blob) return new Response(null, { status: 404 })
        return new Response(request.method === "HEAD" ? null : new Uint8Array(blob.data), {
            status: 200,
            headers: {
                "Cache-Control": "no-store",
                "Content-Type": blob.mime,
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'none'; sandbox",
            },
        })
    })
    scheduleProjectSync()
    setupAutoUpdater()
    await openMainWindow()
    app.on("activate", () => {
        if (quitState === "running" && BrowserWindow.getAllWindows().length === 0) void openMainWindow()
    })
})
app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit()
    }
})
app.on("before-quit", (event) => {
    if (!hasSingleInstanceLock || quitState === "finished") return
    event.preventDefault()
    // A second quit while the harness is stopping must not start another stop
    if (quitState === "stopping") return
    quitState = "stopping"
    if (projectSyncTimer) {
        clearTimeout(projectSyncTimer)
        projectSyncTimer = null
    }
    void harness.stop().finally(() => {
        closeDb()
        quitState = "finished"
        app.quit()
    })
})

function assertNever(value: never): never {
    throw new Error(`Unhandled auth RPC request: ${JSON.stringify(value)}`)
}
