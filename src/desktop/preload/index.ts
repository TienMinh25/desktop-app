import { contextBridge, ipcRenderer } from "electron"
import type { HarnessCommand } from "../../contracts/commands"
import type { HarnessEvent } from "../../contracts/events"
import { IPC_CHANNELS } from "../constants/ipcChannels"

contextBridge.exposeInMainWorld("desktop", {
  minimizeWindow: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE),
  maximizeWindow: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MAXIMIZE),
  closeWindow: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE),
  selectFolder: (): Promise<{ name: string; path: string } | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.SELECT_FOLDER),
  sendHarnessCommand: (command: HarnessCommand): void =>
    ipcRenderer.send(IPC_CHANNELS.HARNESS_COMMAND, command),
  respondToPermission: (permissionRequestId: string, decision: "allow" | "deny"): void =>
    ipcRenderer.send(IPC_CHANNELS.PERMISSION_RESPONSE, { permissionRequestId, decision }),
  respondToQuestion: (questionRequestId: string, answer: string): void =>
    ipcRenderer.send(IPC_CHANNELS.QUESTION_RESPONSE, { questionRequestId, answer }),
  subscribeHarnessEvents: (listener: (event: HarnessEvent) => void): (() => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, event: HarnessEvent) => listener(event)
    ipcRenderer.on(IPC_CHANNELS.HARNESS_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.HARNESS_EVENT, handler)
  },
})
