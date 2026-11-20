import { useEffect, useRef, useState, type FormEvent } from "react"
import cmcLogoLogin from "../../assets/cmc_global_login.jpg"
import { APP_CONFIG } from "../../constants"
import { useAuthStore } from "../../stores"
import { classifyAuthError } from "../../utils/error-message"
import { TermsModal } from "./components/TermsModal"
import styles from "./LoginPage.module.scss"

const MAX_USERNAME_LENGTH = 20
const MAX_PASSWORD_LENGTH = 50

interface LoginPageProps {
  showTermsModal?: boolean
}

export function LoginPage({ showTermsModal = false }: LoginPageProps) {
  const loginSuccess = useAuthStore((state) => state.loginSuccess)
  const agreeTerms = useAuthStore((state) => state.agreeTerms)
  const disagreeTerms = useAuthStore((state) => state.disagreeTerms)
  const externalError = useAuthStore((state) => state.termsDeclinedError)
  const resetCounter = useAuthStore((state) => state.loginResetCounter)
  const usernameInputRef = useRef<HTMLInputElement>(null)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    usernameInputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (resetCounter === 0) return
    setUsername("")
    setPassword("")
    setShowPassword(false)
    setUsernameError(null)
    setPasswordError(null)
    usernameInputRef.current?.focus()
  }, [resetCounter])

  useEffect(() => {
    if (externalError) {
      setErrorMessage(externalError)
    }
  }, [externalError])

  const trimmedUsername = username.trim()
  const isSubmitDisabled = !trimmedUsername || !password || isSubmitting

  const validateUsername = (value: string): string | null => {
    const trimmed = value.trim()
    if (!trimmed) return "Username is required."
    if (trimmed.length > MAX_USERNAME_LENGTH) {
      return `Username must not exceed ${MAX_USERNAME_LENGTH} characters.`
    }
    return null
  }

  const validatePassword = (value: string): string | null => {
    if (!value) return "Password is required."
    if (value.length > MAX_PASSWORD_LENGTH) {
      return `Password must not exceed ${MAX_PASSWORD_LENGTH} characters.`
    }
    return null
  }

  const handleUsernameBlur = () => {
    const trimmed = username.trim()
    if (trimmed !== username) {
      setUsername(trimmed)
    }
    setUsernameError(validateUsername(trimmed))
  }

  const handlePasswordBlur = () => {
    setPasswordError(validatePassword(password))
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return

    const trimmed = username.trim()
    if (trimmed !== username) {
      setUsername(trimmed)
    }

    const nextUsernameError = validateUsername(trimmed)
    const nextPasswordError = validatePassword(password)
    setUsernameError(nextUsernameError)
    setPasswordError(nextPasswordError)

    if (nextUsernameError || nextPasswordError) {
      return
    }

    setErrorMessage(null)
    setIsSubmitting(true)
    try {
      await window.desktop.login(trimmed, password)
      setPassword("")
      loginSuccess(trimmed)
    } catch (error) {
      const { message, isGlobalToast } = classifyAuthError(error)
      if (!isGlobalToast) {
        setErrorMessage(message)
      }
      setPassword("")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className={styles.viewLogin}>
      {/* Left Branding Column */}
      <div className={styles.loginLeft}>
        <div className={styles.brandContent}>
          <div className={styles.loginLogo}>
            <img src={cmcLogoLogin} alt="CMC Global" />
          </div>
          <div className={styles.brandTitle}>C-CodeX</div>
          <div className={styles.brandSubtitle}>Coding Agent</div>

          <div className={styles.featureList}>
            <div className={styles.featureCard}>
              <div className={styles.featureIcon}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M2 4h12M2 8h8M2 12h10"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <div>
                <div className={styles.featureTitle}>AI Chat + Coding Agent</div>
                <div className={styles.featureDesc}>Bound to your assigned projects</div>
              </div>
            </div>

            <div className={styles.featureCard}>
              <div className={styles.featureIcon}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <rect
                    x="2"
                    y="2"
                    width="5.5"
                    height="5.5"
                    rx="1.5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                  <rect
                    x="8.5"
                    y="2"
                    width="5.5"
                    height="5.5"
                    rx="1.5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                  <rect
                    x="2"
                    y="8.5"
                    width="5.5"
                    height="5.5"
                    rx="1.5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                  <rect
                    x="8.5"
                    y="8.5"
                    width="5.5"
                    height="5.5"
                    rx="1.5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                </svg>
              </div>
              <div>
                <div className={styles.featureTitle}>Multi-model Support</div>
                <div className={styles.featureDesc}>OpenAI, Gemini, Claude, DeepSeek</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Form Column */}
      <div className={styles.loginRight}>
        <div className={styles.formWrap}>
          <div className={styles.formTitle}>Sign in</div>
          <div className={styles.formSubtitle}>Use your CMC Global account to continue</div>

          {errorMessage && <div className={styles.loginError}>{errorMessage}</div>}

          <form onSubmit={handleSubmit} noValidate>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="loginUser">
                Username
              </label>
              <input
                ref={usernameInputRef}
                id="loginUser"
                className={`${styles.input} ${usernameError ? styles.inputError : ""}`}
                type="text"
                value={username}
                maxLength={MAX_USERNAME_LENGTH}
                autoFocus
                onChange={(e) => {
                  const sanitized = e.target.value.replace(/\s+/g, "")
                  setUsername(sanitized)
                  if (usernameError) setUsernameError(null)
                  if (errorMessage) setErrorMessage(null)
                }}
                onBlur={handleUsernameBlur}
                placeholder="e.g. username"
                aria-invalid={Boolean(usernameError)}
                aria-describedby={usernameError ? "loginUserError" : undefined}
                required
              />
              {usernameError && (
                <div id="loginUserError" className={styles.fieldError} role="alert">
                  {usernameError}
                </div>
              )}
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="loginPass">
                Password
              </label>
              <div className={styles.passwordInputWrap}>
                <input
                  id="loginPass"
                  className={`${styles.input} ${styles.passwordInput} ${passwordError ? styles.inputError : ""}`}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  maxLength={MAX_PASSWORD_LENGTH}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    if (passwordError) setPasswordError(null)
                    if (errorMessage) setErrorMessage(null)
                  }}
                  onBlur={handlePasswordBlur}
                  placeholder="••••••••"
                  aria-invalid={Boolean(passwordError)}
                  aria-describedby={passwordError ? "loginPassError" : undefined}
                  required
                />
                <button
                  type="button"
                  className={styles.passwordToggleBtn}
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <circle
                        cx="12"
                        cy="12"
                        r="3"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M1 1l22 22"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              </div>
              {passwordError && (
                <div id="loginPassError" className={styles.fieldError} role="alert">
                  {passwordError}
                </div>
              )}
            </div>

            <div className={styles.poaRow}>
              <span className={styles.ldapBadge}>
                <span className={styles.ldapDot} />
                LDAP · CMC Global
              </span>
            </div>

            <button type="submit" className={styles.submitBtn} disabled={isSubmitDisabled}>
              {isSubmitting ? "Signing in…" : "Sign in with CMC Account"}
            </button>
          </form>

          <div className={styles.helpRow}>
            Need help signing in?{" "}
            <a
              href={APP_CONFIG.AMS_SUPPORT_URL}
              target="_blank"
              rel="noreferrer"
              className={styles.helpLink}
            >
              Contact AMS support
            </a>
          </div>
        </div>
      </div>

      {showTermsModal && <TermsModal onAgree={agreeTerms} onDisagree={disagreeTerms} />}
    </div>
  )
}
