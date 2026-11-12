import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { HARNESS_COMMAND_TYPES, HARNESS_EVENT_TYPES } from "../../contracts/message-types"
import styles from "./App.module.scss"
import { TitleBar } from "./components/layout/TitleBar/TitleBar"
import { APP_CONFIG } from "./constants"
import { useToast } from "./hooks/useToast"
import { LoginPage } from "./pages/LoginPage/LoginPage"
import { NoProjectPage } from "./pages/NoProjectPage/NoProjectPage"
import { WorkspacePage } from "./pages/WorkspacePage/WorkspacePage"
import "./styles/global.scss"
import { ThemeProvider, type Theme } from "./theme/ThemeContext"
function AppContent() {
  const [authState, setAuthState] = useState<{
    username: string
    assignedProjects: string[]
  } | null>(null)
  const { toastMessage, showToast } = useToast()

  useEffect(() => {
    const unsubscribe = window.desktop.subscribeHarnessEvents((event) => {
      if (event.type === HARNESS_EVENT_TYPES.PONG) showToast("Harness connected")
    })
    window.desktop.sendHarnessCommand({ type: HARNESS_COMMAND_TYPES.PING, requestId: crypto.randomUUID() })
    return unsubscribe
  }, [showToast])
  const handleLoginSuccess = (username: string, assignedProjects: string[]) => {
    setAuthState({ username, assignedProjects })
  }
  const handleSignOut = () => {
    setAuthState(null)
  }
  const handleThemeChangeToast = (theme: Theme) => {
    showToast(`${theme === "light" ? "Light" : "Dark"} mode enabled.`)
  }
  return (
    <div className={styles.appWindow}>
      <TitleBar title={APP_CONFIG.APP_TITLE} onShowToast={showToast} />
      <div className={styles.viewStage}>
        {!authState ? (
          <LoginPage onLoginSuccess={handleLoginSuccess} />
        ) : authState.assignedProjects.length === 0 ? (
          <NoProjectPage
            username={authState.username}
            onSignOut={handleSignOut}
            onThemeChangeToast={handleThemeChangeToast}
          />
        ) : (
          <WorkspacePage
            username={authState.username}
            assignedProjectIds={authState.assignedProjects}
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
