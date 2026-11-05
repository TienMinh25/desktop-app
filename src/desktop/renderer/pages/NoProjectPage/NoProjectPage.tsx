import { MainLayout } from "../../components/layout/MainLayout/MainLayout"
import { APP_CONFIG } from "../../constants"
import type { Theme } from "../../theme/ThemeContext"
import styles from "./NoProjectPage.module.scss"

interface NoProjectPageProps {
  username: string
  onSignOut: () => void
  onThemeChangeToast: (theme: Theme) => void
}

export function NoProjectPage({ username, onSignOut, onThemeChangeToast }: NoProjectPageProps) {
  const sidebarContent = (
    <div className={styles.sidebarSection}>
      <div className={styles.brand}>
        <span className={styles.brandGlyph}>C</span>
        <span>C-CodeX</span>
      </div>
      <div className={styles.accessState}>
        <span className={styles.accessDot} />
        Account active
      </div>
    </div>
  )

  return (
    <MainLayout
      username={username}
      onSignOut={onSignOut}
      onThemeChangeToast={onThemeChangeToast}
      sidebarContent={sidebarContent}
    >
      <div className={styles.main} aria-labelledby="noProjectTitle">
        <div className={styles.emptyAccessCard}>
          <div className={styles.emptyAccessIcon}>
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2.2h6.5A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />
              <path d="M12 11v4m0 2h.01" strokeLinecap="round" />
            </svg>
          </div>

          <div className={styles.eyebrow}>PROJECT ACCESS</div>
          <h1 id="noProjectTitle" className={styles.title}>
            No projects assigned
          </h1>
          <p className={styles.lead}>
            Your CMC Global account is active, but no active projects are currently allocated to
            you.
          </p>

          <div className={styles.divider} />

          <div className={styles.nextTitle}>To start using C-CodeX</div>

          <div className={styles.accessStep}>
            <span>1</span>
            <div>
              <strong>Contact your IT Administrator</strong>
              <p>Ask them to verify your C-CodeX access and project membership.</p>
            </div>
          </div>

          <div className={styles.accessStep}>
            <span>2</span>
            <div>
              <strong>Contact your Project Manager (PM)</strong>
              <p>Ask your PM to allocate you to an active project in the project system.</p>
            </div>
          </div>

          <p className={styles.accessNote}>
            Chat and coding agent features will be available after a project is assigned.
          </p>

          <div className={styles.accessActions}>
            <a
              className={styles.contactItButton}
              href={`mailto:${APP_CONFIG.IT_HELPDESK_EMAIL}?subject=C-CodeX%20project%20access`}
            >
              Contact IT Administrator
            </a>
            <button className={styles.signoutLink} type="button" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    </MainLayout>
  )
}