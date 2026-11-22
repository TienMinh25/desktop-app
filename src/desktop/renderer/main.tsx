import { StrictMode, useEffect } from "react"
import { createRoot } from "react-dom/client"
import { HARNESS_COMMAND_TYPES, HARNESS_EVENT_TYPES } from "../../contracts/message-types"
import styles from "./App.module.scss"
import { TitleBar } from "./components/layout/TitleBar/TitleBar"
import { ConfirmModal } from "./components/ui/ConfirmModal/ConfirmModal"
import { DebugLogViewer } from "./components/ui/DebugLogModal/DebugLogModal"
import { APP_CONFIG } from "./constants"
import { LoginPage } from "./pages/LoginPage/LoginPage"
import { NoProjectPage } from "./pages/NoProjectPage/NoProjectPage"
import { WorkspacePage } from "./pages/WorkspacePage/WorkspacePage"
import {
  hasAcceptedCurrentTerms,
  toast,
  useAuthStore,
  useChatStore,
  useCustomizeStore,
  useProjectStore,
  useThemeStore,
  useToastStore,
} from "./stores"
import "./styles/global.scss"
import { installDesktopBridgeInterceptor } from "./utils/ipc-interceptor"

// Mounts on every sign-in, so project sync & chat runtime reset cleanly per session
function SignedInApp() {
  const initProjects = useProjectStore((state) => state.initProjects)
  const resetProjects = useProjectStore((state) => state.reset)
  const resetChat = useChatStore((state) => state.reset)
  const resetCustomize = useCustomizeStore((state) => state.reset)
  const isLoaded = useProjectStore((state) => state.isLoaded)
  const loadError = useProjectStore((state) => state.loadError)
  const assignedProjects = useProjectStore((state) => state.assignedProjects)

  useEffect(() => {
    const unsubscribe = initProjects()
    return () => {
      unsubscribe()
      resetProjects()
      resetChat()
      resetCustomize()
    }
  }, [initProjects, resetProjects, resetChat, resetCustomize])

  if (isLoaded && !loadError && assignedProjects.length === 0) {
    return <NoProjectPage />
  }
  return <WorkspacePage />
}

function AppContent() {
  const authState = useAuthStore((state) => state.authState)
  const isAuthLoading = useAuthStore((state) => state.isAuthLoading)
  useAuthStore((state) => state.termsRevision)
  const isSignOutConfirmOpen = useAuthStore((state) => state.isSignOutConfirmOpen)
  const initAuth = useAuthStore((state) => state.initAuth)
  const confirmSignOut = useAuthStore((state) => state.confirmSignOut)
  const closeSignOutConfirm = useAuthStore((state) => state.closeSignOutConfirm)

  const theme = useThemeStore((state) => state.theme)
  const activeToast = useToastStore((state) => state.activeToast)
  const dismissToast = useToastStore((state) => state.dismissToast)

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme)
  }, [theme])

  useEffect(() => installDesktopBridgeInterceptor(), [])
  useEffect(() => initAuth(), [initAuth])

  useEffect(() => {
    const unsubscribe = window.desktop.subscribeHarnessEvents((event) => {
      if (event.type === HARNESS_EVENT_TYPES.PONG) toast.success("Harness connected")
    })
    window.desktop.sendHarnessCommand({
      type: HARNESS_COMMAND_TYPES.PING,
      requestId: crypto.randomUUID(),
    })
    return unsubscribe
  }, [])

  const needsTermsAcceptance = Boolean(
    authState?.authenticated && !hasAcceptedCurrentTerms(authState.username),
  )

  return (
    <div className={styles.appWindow}>
      <TitleBar title={APP_CONFIG.APP_TITLE} />
      <div className={styles.viewStage}>
        {isAuthLoading ? (
          <div className={styles.authLoading} role="status">Checking sign-in status…</div>
        ) : !authState?.authenticated || needsTermsAcceptance ? (
          <LoginPage showTermsModal={needsTermsAcceptance} />
        ) : (
          <SignedInApp />
        )}

        {isSignOutConfirmOpen && (
          <ConfirmModal
            title="Sign out"
            message="Are you sure you want to sign out of C-CodeX Desktop?"
            confirmLabel="Sign out"
            cancelLabel="Cancel"
            variant="danger"
            onConfirm={confirmSignOut}
            onCancel={closeSignOutConfirm}
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
    <AppContent />
  </StrictMode>,
)
