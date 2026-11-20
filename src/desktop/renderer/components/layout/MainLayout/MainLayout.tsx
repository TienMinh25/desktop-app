import type { ReactNode } from "react"
import { Sidebar } from "../Sidebar/Sidebar"
import styles from "./MainLayout.module.scss"

interface MainLayoutProps {
  sidebarContent: ReactNode
  children: ReactNode
}

export function MainLayout({ sidebarContent, children }: MainLayoutProps) {
  return (
    <div className={styles.layout}>
      <Sidebar>{sidebarContent}</Sidebar>
      <main className={styles.mainContent}>{children}</main>
    </div>
  )
}
