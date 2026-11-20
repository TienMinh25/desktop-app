import type { AuthState } from "../../../../contracts/auth"
import { APP_CONFIG, STORAGE_KEYS } from "../../constants"
import { formatGeneralErrorMessage } from "../../utils/error-message"
import { createAppStore } from "../create-store"
import { toast } from "./toast.store"

const AUTH_ACTIONS = {
  EVENT_STATE: "auth/eventState",
  INIT_LOADED: "auth/initLoaded",
  INIT_FAILED: "auth/initFailed",
  LOGIN_SUCCESS: "auth/loginSuccess",
  AGREE_TERMS: "auth/agreeTerms",
  DISAGREE_TERMS: "auth/disagreeTerms",
  OPEN_SIGN_OUT_CONFIRM: "auth/openSignOutConfirm",
  CLOSE_SIGN_OUT_CONFIRM: "auth/closeSignOutConfirm",
  CONFIRM_SIGN_OUT: "auth/confirmSignOut",
  LOGGED_OUT: "auth/loggedOut",
} as const

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

export function hasAcceptedCurrentTerms(username: string | null): boolean {
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

interface AuthStoreState {
  authState: AuthState | null
  isAuthLoading: boolean
  termsRevision: number
  termsDeclinedError: string | null
  loginResetCounter: number
  isSignOutConfirmOpen: boolean

  initAuth: () => () => void
  loginSuccess: (username: string) => void
  agreeTerms: () => void
  disagreeTerms: () => void
  openSignOutConfirm: () => void
  closeSignOutConfirm: () => void
  confirmSignOut: () => void
}

export const useAuthStore = createAppStore<AuthStoreState>("AuthStore", (set, get) => ({
      authState: null,
      isAuthLoading: true,
      termsRevision: 0,
      termsDeclinedError: null,
      loginResetCounter: 0,
      isSignOutConfirmOpen: false,

      initAuth: () => {
        let active = true
        let receivedAuthEvent = false

        const unsubscribe = window.desktop.subscribeAuthState((state) => {
          receivedAuthEvent = true
          set({ authState: state, isAuthLoading: false }, false, AUTH_ACTIONS.EVENT_STATE)
        })

        void window.desktop
          .getAuthState()
          .then((state) => {
            if (active && !receivedAuthEvent) {
              set({ authState: state, isAuthLoading: false }, false, AUTH_ACTIONS.INIT_LOADED)
            }
          })
          .catch(() => {
            if (active) set({ isAuthLoading: false }, false, AUTH_ACTIONS.INIT_FAILED)
          })

        return () => {
          active = false
          unsubscribe()
        }
      },

      loginSuccess: (username) =>
        set(
          {
            termsDeclinedError: null,
            authState: { authenticated: true, username },
          },
          false,
          AUTH_ACTIONS.LOGIN_SUCCESS,
        ),

      agreeTerms: () => {
        const username = get().authState?.username
        if (username) {
          saveAcceptedCurrentTerms(username)
          set((state) => ({ termsRevision: state.termsRevision + 1 }), false, AUTH_ACTIONS.AGREE_TERMS)
        }
      },

      disagreeTerms: () => {
        set(
          (state) => ({
            loginResetCounter: state.loginResetCounter + 1,
            termsDeclinedError:
              "You must agree to the Terms of Use and Privacy Policy to access C-CodeX Assistant.",
          }),
          false,
          AUTH_ACTIONS.DISAGREE_TERMS,
        )
        void window.desktop
          .logout()
          .catch(() => {})
          .finally(() =>
            set({ authState: { authenticated: false, username: null } }, false, AUTH_ACTIONS.LOGGED_OUT),
          )
      },

      openSignOutConfirm: () =>
        set({ isSignOutConfirmOpen: true }, false, AUTH_ACTIONS.OPEN_SIGN_OUT_CONFIRM),
      closeSignOutConfirm: () =>
        set({ isSignOutConfirmOpen: false }, false, AUTH_ACTIONS.CLOSE_SIGN_OUT_CONFIRM),

      confirmSignOut: () => {
        set({ isSignOutConfirmOpen: false }, false, AUTH_ACTIONS.CONFIRM_SIGN_OUT)
        void window.desktop
          .logout()
          .catch((error) => toast.error(formatGeneralErrorMessage(error, "Signed out locally")))
          .finally(() =>
            set({ authState: { authenticated: false, username: null } }, false, AUTH_ACTIONS.LOGGED_OUT),
          )
      },
}))
