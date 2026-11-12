/// <reference types="vite/client" />
import type { HarnessCommand } from "../../contracts/commands"
import type { HarnessEvent } from "../../contracts/events"

declare global {
  interface SelectedFolderInfo {
    name: string
    path: string
  }

  interface DesktopBridge {
    minimizeWindow: () => void
    maximizeWindow: () => void
    closeWindow: () => void
    selectFolder: () => Promise<SelectedFolderInfo | null>
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
