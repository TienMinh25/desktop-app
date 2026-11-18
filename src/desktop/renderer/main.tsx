import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { HARNESS_COMMAND_TYPES, HARNESS_EVENT_TYPES } from "../../contracts/message-types"
import styles from "./App.module.scss"
import { TitleBar } from "./components/layout/TitleBar/TitleBar"
import { APP_CONFIG } from "./constants"
import { useToast } from "./hooks/useToast"
import { LoginPage } from "./pages/LoginPage/LoginPage"
import { WorkspacePage } from "./pages/WorkspacePage/WorkspacePage"
import "./styles/global.scss"
import { ThemeProvider, type Theme } from "./theme/ThemeContext"
import type { AuthState } from "../../contracts/auth"
function AppContent() {
  const [authState, setAuthState] = useState<AuthState | null>(null)
  const [isAuthLoading, setIsAuthLoading] = useState(true)
  const { toastMessage, showToast } = useToast()

  useEffect(() => {
    let active = true
    let receivedAuthEvent = false
    const unsubscribe = window.desktop.subscribeAuthState((state) => {
      receivedAuthEvent = true
      setAuthState(state)
      setIsAuthLoading(false)
    })
    void window.desktop.getAuthState().then((state) => {
      if (active && !receivedAuthEvent) {
        setAuthState(state)
        setIsAuthLoading(false)
      }
    }).catch(() => {
      if (active) setIsAuthLoading(false)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.desktop.subscribeHarnessEvents((event) => {
      if (event.type === HARNESS_EVENT_TYPES.PONG) showToast("Harness connected")
    })
    window.desktop.sendHarnessCommand({ type: HARNESS_COMMAND_TYPES.PING, requestId: crypto.randomUUID() })
    return unsubscribe
  }, [showToast])
  const handleLoginSuccess = (username: string) => {
    setAuthState({ authenticated: true, username })
  }
  const handleSignOut = () => {
    void window.desktop.logout()
      .catch((error) => showToast(error instanceof Error ? error.message : "Signed out locally"))
      .finally(() => setAuthState({ authenticated: false, username: null }))
  }
  const handleThemeChangeToast = (theme: Theme) => {
    showToast(`${theme === "light" ? "Light" : "Dark"} mode enabled.`)
  }
  return (
    <div className={styles.appWindow}>
      <TitleBar title={APP_CONFIG.APP_TITLE} onShowToast={showToast} />
      <div className={styles.viewStage}>
        {isAuthLoading ? (
          <div className={styles.authLoading} role="status">Checking sign-in status…</div>
        ) : !authState?.authenticated ? (
          <LoginPage onLoginSuccess={handleLoginSuccess} />
        ) : (
          <WorkspacePage
            username={authState.username ?? ""}
            onSignOut={handleSignOut}
            onShowToast={showToast}
            onThemeChangeToast={handleThemeChangeToast}
          />
        )}
        {toastMessage && (
          <div className={styles.appToast} role="status" aria-live="polite">
            {toastMessage}
          </div>
        )}
      </div>
    </div>
  )
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  </StrictMode>,
)
