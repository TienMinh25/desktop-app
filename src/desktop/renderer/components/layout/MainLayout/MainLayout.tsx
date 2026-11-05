import type { ReactNode } from "react"
import type { Theme } from "../../../theme/ThemeContext"
import { Sidebar } from "../Sidebar/Sidebar"
import styles from "./MainLayout.module.scss"

interface MainLayoutProps {
  username: string
  onSignOut: () => void
  onThemeChangeToast?: (theme: Theme) => void
  sidebarContent: ReactNode
  children: ReactNode
}

export function MainLayout({
  username,
  onSignOut,
  onThemeChangeToast,
  sidebarContent,
  children,
}: MainLayoutProps) {
  return (
    <div className={styles.layout}>
      <Sidebar
        username={username}
        onSignOut={onSignOut}
        onThemeChangeToast={onThemeChangeToast}
      >
        {sidebarContent}
      </Sidebar>
      <main className={styles.mainContent}>{children}</main>
    </div>
  )
}