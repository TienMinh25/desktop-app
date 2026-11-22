import { createAppStore } from "../create-store"

const CUSTOMIZE_ACTIONS = {
  OPEN: "customize/open",
  CLOSE: "customize/close",
  REFRESH_LSP_STATUS: "customize/refreshLspStatus",
  REFRESH_LSP_STATUS_FAILED: "customize/refreshLspStatusFailed",
  RESET: "customize/reset",
} as const

export type CustomizeTab = "skills" | "connectors" | "lsp"

interface CustomizeState {
  isOpen: boolean
  initialTab: CustomizeTab
  hasEnabledLspServer: boolean | null

  openCustomize: (tab?: CustomizeTab) => void
  closeCustomize: () => void
  refreshLspStatus: () => Promise<void>
  reset: () => void
}

export const useCustomizeStore = createAppStore<CustomizeState>("CustomizeStore", (set) => ({
  isOpen: false,
  initialTab: "connectors",
  hasEnabledLspServer: null,

  openCustomize: (tab = "connectors") =>
    set({ isOpen: true, initialTab: tab }, false, CUSTOMIZE_ACTIONS.OPEN),

  closeCustomize: () => set({ isOpen: false }, false, CUSTOMIZE_ACTIONS.CLOSE),

  refreshLspStatus: async () => {
    try {
      const servers = await window.desktop.listLspServers()
      set(
        { hasEnabledLspServer: servers.some((server) => server.enabled) },
        false,
        CUSTOMIZE_ACTIONS.REFRESH_LSP_STATUS,
      )
    } catch {
      set({ hasEnabledLspServer: false }, false, CUSTOMIZE_ACTIONS.REFRESH_LSP_STATUS_FAILED)
    }
  },

  reset: () =>
    set(
      { isOpen: false, initialTab: "connectors", hasEnabledLspServer: null },
      false,
      CUSTOMIZE_ACTIONS.RESET,
    ),
}))
