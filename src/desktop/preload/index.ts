import { contextBridge, ipcRenderer } from "electron"
import { IPC_CHANNELS } from "../constants/ipcChannels"
contextBridge.exposeInMainWorld("desktop", {
  minimizeWindow: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE),
  maximizeWindow: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MAXIMIZE),
  closeWindow: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE),
  selectFolder: (): Promise<{ name: string; path: string } | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.SELECT_FOLDER),
})