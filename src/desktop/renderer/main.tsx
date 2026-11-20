import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { HARNESS_COMMAND_TYPES, HARNESS_EVENT_TYPES } from "../../contracts/message-types"
import styles from "./App.module.scss"
import { TitleBar } from "./components/layout/TitleBar/TitleBar"
import { ConfirmModal } from "./components/ui/ConfirmModal/ConfirmModal"
import { DebugLogViewer } from "./components/ui/DebugLogModal/DebugLogModal"
import { APP_CONFIG, STORAGE_KEYS } from "./constants"
import { useProjectSessions } from "./hooks/useProjectSessions"
import { useToast } from "./hooks/useToast"
import { LoginPage } from "./pages/LoginPage/LoginPage"
import { NoProjectPage } from "./pages/NoProjectPage/NoProjectPage"
import { WorkspacePage } from "./pages/WorkspacePage/WorkspacePage"
import "./styles/global.scss"
import { ThemeProvider, type Theme } from "./theme/ThemeContext"
import { formatGeneralErrorMessage } from "./utils/error-message"
import { installDesktopBridgeInterceptor } from "./utils/ipc-interceptor"
import type { AuthState } from "../../contracts/auth"

const CURRENT_TERMS_TOKEN = `${APP_CONFIG.TERMS_VERSION}:${APP_CONFIG.PRIVACY_VERSION}`

function getAcceptedTermsMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ACCEPTED_TERMS_VERSION)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function hasAcceptedCurrentTerms(username: string | null): boolean {
  if (!username) return false
  return getAcceptedTermsMap()[username] === CURRENT_TERMS_TOKEN
}

function saveAcceptedCurrentTerms(username: string): void {
  try {
    const map = getAcceptedTermsMap()
    map[username] = CURRENT_TERMS_TOKEN
    localStorage.setItem(STORAGE_KEYS.ACCEPTED_TERMS_VERSION, JSON.stringify(map))
  } catch {
    // Ignore storage errors
  }
}

interface SignedInAppProps {
  username: string
  onSignOut: () => void
  onShowToast: (message: string) => void
  onThemeChangeToast: (theme: Theme) => void
}

// Mounts on every sign-in, so the project list (and its backend sync) loads per login
function SignedInApp({ username, onSignOut, onShowToast, onThemeChangeToast }: SignedInAppProps) {
  const projectSessions = useProjectSessions(onShowToast)
  const { isLoaded, loadError, assignedProjects } = projectSessions
  if (isLoaded && !loadError && assignedProjects.length === 0) {
    return <NoProjectPage username={username} onSignOut={onSignOut} onThemeChangeToast={onThemeChangeToast} />
  }
  return (
    <WorkspacePage
      username={username}
      projectSessions={projectSessions}
      onSignOut={onSignOut}
      onShowToast={onShowToast}
      onThemeChangeToast={onThemeChangeToast}
    />
  )
}

function AppContent() {
  const [authState, setAuthState] = useState<AuthState | null>(null)
  const [isAuthLoading, setIsAuthLoading] = useState(true)
  const [, setTermsRevision] = useState(0)
  const [termsDeclinedError, setTermsDeclinedError] = useState<string | null>(null)
  const [loginResetCounter, setLoginResetCounter] = useState(0)
  const [isSignOutConfirmOpen, setIsSignOutConfirmOpen] = useState(false)
  const { activeToast, showToast, dismissToast } = useToast()

  useEffect(() => {
    return installDesktopBridgeInterceptor()
  }, [])

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
    setTermsDeclinedError(null)
    setAuthState({ authenticated: true, username })
  }

  const handleAgreeTerms = () => {
    if (authState?.username) {
      saveAcceptedCurrentTerms(authState.username)
      setTermsRevision((prev) => prev + 1)
    }
  }

  const handleDisagreeTerms = () => {
    setLoginResetCounter((prev) => prev + 1)
    setTermsDeclinedError(
      "You must agree to the Terms of Use and Privacy Policy to access C-CodeX Assistant.",
    )
    void window.desktop.logout()
      .catch(() => {})
      .finally(() => setAuthState({ authenticated: false, username: null }))
  }

  const performSignOut = () => {
    setIsSignOutConfirmOpen(false)
    void window.desktop.logout()
      .catch((error) => showToast(formatGeneralErrorMessage(error, "Signed out locally")))
      .finally(() => setAuthState({ authenticated: false, username: null }))
  }

  const handleThemeChangeToast = (theme: Theme) => {
    showToast(`${theme === "light" ? "Light" : "Dark"} mode enabled.`)
  }

  const needsTermsAcceptance = Boolean(
    authState?.authenticated && !hasAcceptedCurrentTerms(authState.username),
  )

  return (
    <div className={styles.appWindow}>
      <TitleBar title={APP_CONFIG.APP_TITLE} onShowToast={showToast} />
      <div className={styles.viewStage}>
        {isAuthLoading ? (
          <div className={styles.authLoading} role="status">Checking sign-in status…</div>
        ) : !authState?.authenticated || needsTermsAcceptance ? (
          <LoginPage
            onLoginSuccess={handleLoginSuccess}
            showTermsModal={needsTermsAcceptance}
            onAgreeTerms={handleAgreeTerms}
            onDisagreeTerms={handleDisagreeTerms}
            externalError={termsDeclinedError}
            resetCounter={loginResetCounter}
          />
        ) : (
          <SignedInApp
            username={authState.username ?? ""}
            onSignOut={() => setIsSignOutConfirmOpen(true)}
            onShowToast={showToast}
            onThemeChangeToast={handleThemeChangeToast}
          />
        )}
        {isSignOutConfirmOpen && (
          <ConfirmModal
            title="Sign out"
            message="Are you sure you want to sign out of C-CodeX Desktop?"
            confirmLabel="Sign out"
            cancelLabel="Cancel"
            variant="danger"
            onConfirm={performSignOut}
            onCancel={() => setIsSignOutConfirmOpen(false)}
          />
        )}
        <DebugLogViewer />
        {activeToast && (
          <div
            className={`${styles.appToast} ${
              activeToast.type === "error"
                ? styles.toastError
                : activeToast.type === "success"
                  ? styles.toastSuccess
                  : activeToast.type === "warning"
                    ? styles.toastWarning
                    : styles.toastInfo
            }`}
            role={activeToast.type === "error" ? "alert" : "status"}
            aria-live={activeToast.type === "error" ? "assertive" : "polite"}
          >
            <span className={styles.toastIcon} aria-hidden="true">
              {activeToast.type === "error" ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 8v5m0 3.5h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : activeToast.type === "success" ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                  <path d="m8.5 12.5 2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 11v5m0-8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              )}
            </span>
            <span className={styles.toastMessage}>{activeToast.message}</span>
            <button
              type="button"
              className={styles.toastClose}
              onClick={dismissToast}
              aria-label="Close notification"
            >
              ×
            </button>
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
