import { basename } from "node:path"
import { fileURLToPath } from "node:url"
import { app, BrowserWindow, dialog, ipcMain, screen } from "electron"
import { IPC_CHANNELS } from "../constants/ipcChannels"
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
app.whenReady().then(() => {
    createWindow()
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow()
        }
    })
})
app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit()
    }
})