import { useTheme, type Theme } from "../../../theme/ThemeContext"
import styles from "./SidebarFooter.module.scss"

interface SidebarFooterProps {
  username: string
  role?: string
  onSignOut: () => void
  onThemeChangeToast?: (theme: Theme) => void
}

export function SidebarFooter({
  username,
  role = "Project Member",
  onSignOut,
  onThemeChangeToast,
}: SidebarFooterProps) {
  const { theme, setTheme } = useTheme()
  const initials = (username || "CU").slice(0, 2).toUpperCase()

  const handleSetTheme = (nextTheme: Theme) => {
    setTheme(nextTheme)
    onThemeChangeToast?.(nextTheme)
  }

  return (
    <div className={styles.footer}>
      <div className={styles.profileInfo}>
        <div className={styles.avatar}>{initials}</div>
        <div className={styles.meta}>
          <div className={styles.username}>{username || "CMC User"}</div>
          <div className={styles.role}>{role}</div>
        </div>
      </div>

      <div className={styles.footerTools}>
        <div className={styles.themeControls} aria-label="Appearance">
          <button
            className={`${styles.themeButton} ${theme === "dark" ? styles.active : ""}`}
            type="button"
            onClick={() => handleSetTheme("dark")}
            aria-label="Dark mode"
            aria-pressed={theme === "dark"}
            title="Dark mode"
          >
            <svg viewBox="0 0 16 16" fill="none">
              <path
                d="M13.5 10.2A5.8 5.8 0 0 1 5.8 2.5 5.8 5.8 0 1 0 13.5 10.2Z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            className={`${styles.themeButton} ${theme === "light" ? styles.active : ""}`}
            type="button"
            onClick={() => handleSetTheme("light")}
            aria-label="Light mode"
            aria-pressed={theme === "light"}
            title="Light mode"
          >
            <svg viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="2.6" stroke="currentColor" strokeWidth="1.2" />
              <path
                d="M8 1.3v1.4M8 13.3v1.4M1.3 8h1.4m10.6 0h1.4M3.27 3.27l1 1m7.46 7.46 1 1m0-9.46-1 1m-7.46 7.46-1 1"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <button
          className={styles.signoutButton}
          type="button"
          onClick={onSignOut}
          title="Sign out"
          aria-label="Sign out"
        >
          <svg viewBox="0 0 16 16" fill="none">
            <path
              d="M6 3H3.5A1.5 1.5 0 0 0 2 4.5v7A1.5 1.5 0 0 0 3.5 13H6M10 11l3-3-3-3m3 3H6"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  )
}