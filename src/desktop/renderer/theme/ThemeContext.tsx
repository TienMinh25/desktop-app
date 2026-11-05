import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { STORAGE_KEYS } from "../constants"
export type Theme = "dark" | "light"
interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
}
const ThemeContext = createContext<ThemeContextValue | null>(null)
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.THEME)
      return saved === "light" || saved === "dark" ? saved : "dark"
    } catch {
      return "dark"
    }
  })
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme)
    try {
      localStorage.setItem(STORAGE_KEYS.THEME, theme)
    } catch {
      // Ignore storage write error
    }
  }, [theme])
  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"))
  }
  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }
  return context
}