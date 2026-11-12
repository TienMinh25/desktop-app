import { basename } from "node:path"
import { join } from "node:path"
import { mkdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { app, BrowserWindow, dialog, ipcMain, screen, utilityProcess, type UtilityProcess } from "electron"
import { HARNESS_COMMAND_TYPES } from "../../contracts/message-types"
import { PermissionResponseCommandSchema, QuestionResponseCommandSchema } from "../../contracts/commands"
import type { HarnessEvent } from "../../contracts/events"
import { isHarnessCommand } from "../../contracts/guards"
import { IPC_CHANNELS } from "../constants/ipcChannels"

let harnessProcess: UtilityProcess | null = null

function startHarnessProcess() {
    const entryPath = fileURLToPath(new URL("./harness-server.js", import.meta.url))
    harnessProcess = utilityProcess.fork(entryPath, [], {
        serviceName: "Ccodex Harness",
    })
    harnessProcess.on("message", (event: HarnessEvent) => {
        for (const window of BrowserWindow.getAllWindows()) {
            window.webContents.send(IPC_CHANNELS.HARNESS_EVENT, event)
        }
    })
}

function forwardHarnessCommand(command: unknown) {
    if (!harnessProcess) return
    harnessProcess.postMessage(command)
}

ipcMain.on(IPC_CHANNELS.HARNESS_COMMAND, (event, command: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender) || !isHarnessCommand(command) || command.type === HARNESS_COMMAND_TYPES.PERMISSION_RESPOND || command.type === HARNESS_COMMAND_TYPES.QUESTION_RESPOND) return
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

app.whenReady().then(async () => {
    await mkdir(join(app.getPath("home"), ".ccodex"), { recursive: true })
    startHarnessProcess()
    createWindow()
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow()
        }
    })
})
app.on("window-all-closed", () => {
    harnessProcess?.kill()
    harnessProcess = null
    if (process.platform !== "darwin") {
        app.quit()
    }
})
