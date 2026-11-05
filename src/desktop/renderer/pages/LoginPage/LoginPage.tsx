import { useState, type FormEvent } from "react"
import cmcLogoLogin from "../../assets/cmc_global_login.jpg"
import { APP_CONFIG } from "../../constants"
import { DEMO_ACCOUNTS } from "../../data/mockData"
import { TermsModal } from "./components/TermsModal"
import styles from "./LoginPage.module.scss"

interface LoginPageProps {
  onLoginSuccess: (username: string, assignedProjects: string[]) => void
}

export function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [pendingUser, setPendingUser] = useState<{
    username: string
    projects: string[]
  } | null>(null)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmedUser = username.trim()
    const account = DEMO_ACCOUNTS[trimmedUser]

    if (account && account.password === password) {
      setErrorMessage(null)
      setPendingUser({ username: trimmedUser, projects: [...account.projects] })
    } else {
      setErrorMessage("Invalid username or password. Please try again.")
    }
  }

  const handleAgreeTerms = () => {
    if (!pendingUser) return
    const { username: confirmedUser, projects } = pendingUser
    setPendingUser(null)
    onLoginSuccess(confirmedUser, projects)
  }

  const handleDisagreeTerms = () => {
    setPendingUser(null)
    setErrorMessage(
      "You must agree to the Terms of Use and Privacy Policy to access C-CodeX Assistant.",
    )
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
          <div className={styles.brandSubtitle}>AI Coding Assistant · Desktop App</div>

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

        <div className={styles.poweredBy}>Powered by CMC Global · POA Identity</div>
      </div>

      {/* Right Form Column */}
      <div className={styles.loginRight}>
        <div className={styles.formWrap}>
          <div className={styles.formTitle}>Sign in</div>
          <div className={styles.formSubtitle}>Use your CMC Global account to continue</div>

          {errorMessage && <div className={styles.loginError}>{errorMessage}</div>}

          <form onSubmit={handleSubmit}>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="loginUser">
                Username
              </label>
              <input
                id="loginUser"
                className={styles.input}
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. username"
                required
              />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="loginPass">
                Password
              </label>
              <div className={styles.passwordInputWrap}>
                <input
                  id="loginPass"
                  className={`${styles.input} ${styles.passwordInput}`}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
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
                  ) : (
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
                  )}
                </button>
              </div>
            </div>

            <div className={styles.poaRow}>
              <span className={styles.ldapBadge}>
                <span className={styles.ldapDot} />
                LDAP · CMC Global
              </span>
              <span className={styles.poaNote}>Authenticated via POA</span>
            </div>

            <button type="submit" className={styles.submitBtn}>
              Sign in with CMC Account
            </button>
          </form>

          <div className={styles.helpRow}>
            Need help signing in?{" "}
            <a href={`mailto:${APP_CONFIG.IT_HELPDESK_EMAIL}`} className={styles.helpLink}>
              Contact IT Support
            </a>
          </div>
        </div>
      </div>

      {pendingUser && (
        <TermsModal onAgree={handleAgreeTerms} onDisagree={handleDisagreeTerms} />
      )}
    </div>
  )
}