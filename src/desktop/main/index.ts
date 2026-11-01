import { fileURLToPath } from "node:url"
import {app, BrowserWindow} from "electron"

function createWindow() {
    const window = new BrowserWindow({
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