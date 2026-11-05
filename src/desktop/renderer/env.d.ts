/// <reference types="vite/client" />
interface SelectedFolderInfo {
  name: string
  path: string
}
interface DesktopBridge {
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
  selectFolder: () => Promise<SelectedFolderInfo | null>
}
interface Window {
  desktop?: DesktopBridge
  showDirectoryPicker?: () => Promise<{ name: string }>
}