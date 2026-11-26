import { STORAGE_KEYS } from "../../constants"
import { createPersistedAppStore } from "../create-store"

const THEME_ACTIONS = {
  SET: "theme/set",
  TOGGLE: "theme/toggle",
} as const

export type Theme = "dark" | "light"

interface ThemeState {
  theme: Theme
  actions: {
    setTheme: (theme: Theme) => void
    toggleTheme: () => void
  }
}

function applyThemeAttribute(theme: Theme): void {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme)
  }
}

export const useThemeStore = createPersistedAppStore<ThemeState, Pick<ThemeState, "theme">>(
  "ThemeStore",
  (set) => ({
    theme: "dark",

    actions: {
      setTheme: (theme) => {
        applyThemeAttribute(theme)
        set({ theme }, false, THEME_ACTIONS.SET)
      },

      toggleTheme: () =>
        set(
          (state) => {
            const next: Theme = state.theme === "dark" ? "light" : "dark"
            applyThemeAttribute(next)
            return { theme: next }
          },
          false,
          THEME_ACTIONS.TOGGLE,
        ),
    },
  }),
  {
    name: STORAGE_KEYS.THEME,
    partialize: (state) => ({ theme: state.theme }),
    onRehydrateStorage: () => (state) => {
      applyThemeAttribute(state?.theme ?? "dark")
    },
  },
)
