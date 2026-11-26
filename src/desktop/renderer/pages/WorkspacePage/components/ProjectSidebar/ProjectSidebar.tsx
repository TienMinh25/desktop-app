import { useEffect, useRef, useState, type MouseEvent } from "react"
import type { SidebarSearchResult } from "../../../../../../contracts/projects"
import { SIDEBAR_SEARCH_CONFIG } from "../../../../constants"
import { useClickOutside } from "../../../../hooks/useClickOutside"
import { splitHighlightParts } from "../../../../utils/text"
import {
  newestFirst,
  useChatStore,
  useCustomizeStore,
  useProjectStore,
  type ChatSession,
} from "../../../../stores"
import styles from "./ProjectSidebar.module.scss"

interface SessionMenuState {
  sessionId: string
  top: number
  left: number
}

export function ProjectSidebar() {
  const projects = useProjectStore((state) => state.assignedProjects)
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId)
  const sessions = useProjectStore((state) => state.sessions)
  const activeSessionId = useProjectStore((state) => state.activeSessionId)
  const expandedProjects = useProjectStore((state) => state.expandedProjects)
  const { selectProject, toggleExpandProject, selectSession, createNewChat, renameSession, deleteSession } =
    useProjectStore((state) => state.actions)

  const isCustomizeActive = useCustomizeStore((state) => state.isOpen)
  const { openCustomize, closeCustomize } = useCustomizeStore((state) => state.actions)

  const clearSessionRuntime = useChatStore((state) => state.actions.clearSessionRuntime)

  const displaySelectedProjectId = isCustomizeActive ? null : selectedProjectId
  const displayActiveSessionId = isCustomizeActive ? null : activeSessionId
  const [searchQuery, setSearchQuery] = useState("")
  const [openMenuSession, setOpenMenuSession] = useState<SessionMenuState | null>(null)
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const sessionMenuRef = useRef<HTMLDivElement>(null)

  useClickOutside(sessionMenuRef, () => setOpenMenuSession(null))

  // Search runs in the DB (project name, chat title), the list may be too long to filter here
  const query = searchQuery.trim()
  const [hits, setHits] = useState<SidebarSearchResult | null>(null)
  useEffect(() => {
    if (!query) return setHits(null)
    let stale = false
    const timer = setTimeout(() => {
      window.desktop.searchSidebar(query).then((result) => !stale && setHits(result)).catch(() => !stale && setHits(null))
    }, SIDEBAR_SEARCH_CONFIG.DEBOUNCE_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [query])
  // Until the first result arrives the full list stays on screen
  const searching = !!query && !!hits
  const sessionHit = (session: ChatSession) => !!hits?.sessionIds.includes(session.id)
  const projectHit = (projectId: string) => !!hits?.projectIds.includes(projectId)
  const hasMatch = !searching || projects.some((p) => projectHit(p.id) || sessions.some((s) => s.projectId === p.id && sessionHit(s)))

  const handleSessionMouseEnter = (event: MouseEvent<HTMLDivElement>) => {
    const copyEl = event.currentTarget.querySelector<HTMLElement>(`.${styles.treeSessionCopy}`)
    const titleEl = event.currentTarget.querySelector<HTMLElement>(`.${styles.treeSessionTitle}`)
    const marqueeClass = styles.marqueeActive
    if (!copyEl || !titleEl || !marqueeClass) return

    const overflowWidth = titleEl.scrollWidth - copyEl.clientWidth
    if (overflowWidth > 2) {
      const durationSec = Math.max(1.6, Math.min(4.5, overflowWidth / 32))
      titleEl.style.setProperty("--marquee-offset", `-${overflowWidth}px`)
      titleEl.style.setProperty("--marquee-duration", `${durationSec}s`)
      titleEl.classList.add(marqueeClass)
    } else {
      titleEl.classList.remove(marqueeClass)
    }
  }

  const handleSessionMouseLeave = (event: MouseEvent<HTMLDivElement>) => {
    const titleEl = event.currentTarget.querySelector<HTMLElement>(`.${styles.treeSessionTitle}`)
    const marqueeClass = styles.marqueeActive
    if (!titleEl || !marqueeClass) return
    titleEl.classList.remove(marqueeClass)
  }

  return (
    <div className={styles.sidebarTop}>
      <button
        type="button"
        className={`${styles.customizeNavBtn} ${isCustomizeActive ? styles.customizeActive : ""}`}
        onClick={() => openCustomize("connectors")}
      >
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.35" />
          <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.35" />
          <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.35" />
          <path d="M11.5 9.2v4.6M9.2 11.5h4.6" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        </svg>
        <span>Customize</span>
      </button>

      <div className={styles.sectionHead}>
        <span>Projects</span>
        <button
          className={styles.newChatButton}
          type="button"
          onClick={() => {
            // Clear search so the new chat is visible
            setSearchQuery("")
            closeCustomize()
            void createNewChat(selectedProjectId)
          }}
          title="Start a new chat in the active project"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 3v10M3 8h10"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
          <span>New chat</span>
        </button>
      </div>

      <div className={styles.searchBox}>
        <svg className={styles.searchIcon} viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M10.5 10.5L14 14"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        <input
          className={styles.searchInput}
          placeholder="Search projects and chats..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div
        className={styles.projectTree}
        aria-label="Projects"
        onScroll={() => {
          if (openMenuSession) setOpenMenuSession(null)
        }}
      >
        {projects.length === 0 ? (
          <div className={styles.sidebarEmpty}>No assigned projects.</div>
        ) : !hasMatch ? (
          <div className={styles.sidebarEmpty}>Nothing matches "{query}".</div>
        ) : (
          projects.map((project) => {
            // Show hits even in a collapsed project
            const isExpanded = searching || !!expandedProjects[project.id]
            const isSelected = displaySelectedProjectId === project.id
            const projectSessions = sessions
              .filter((s) => s.projectId === project.id)
              .sort(newestFirst)
              // A project whose name matches keeps all its chats
              .filter((s) => !searching || projectHit(project.id) || sessionHit(s))
            if (searching && !projectHit(project.id) && projectSessions.length === 0) return null

            return (
              <section
                key={project.id}
                className={`${styles.projectEntry} ${isExpanded ? styles.expanded : ""}`}
              >
                <div className={styles.projectEntryHead}>
                  <button
                    type="button"
                    className={`${styles.projectSelect} ${isSelected ? styles.active : ""}`}
                    title={`Open ${project.name}`}
                    aria-expanded={isExpanded}
                    onClick={() => {
                      closeCustomize()
                      selectProject(project.id)
                      toggleExpandProject(project.id)
                    }}
                  >
                    {isExpanded ? (
                      <svg
                        className={styles.projectFolderIcon}
                        width="15"
                        height="15"
                        viewBox="0 0 16 16"
                        fill="none"
                      >
                        <path
                          d="M1.5 12.2V4a1 1 0 0 1 1-1h3.2l1.4 1.5H13a1 1 0 0 1 1 1v1.5"
                          stroke="currentColor"
                          strokeWidth="1.25"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M1.5 12.2 3.1 7h11.4l-1.6 5.2a1 1 0 0 1-.95.7H2.45a.95.95 0 0 1-.95-.7Z"
                          stroke="currentColor"
                          strokeWidth="1.25"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : (
                      <svg
                        className={styles.projectFolderIcon}
                        width="15"
                        height="15"
                        viewBox="0 0 16 16"
                        fill="none"
                      >
                        <path
                          d="M1.5 4a1 1 0 0 1 1-1h3.2l1.4 1.5H13a1 1 0 0 1 1 1v6.8a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1z"
                          stroke="currentColor"
                          strokeWidth="1.25"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                    <span className={styles.projectName}>
                      {splitHighlightParts(project.name, query).map((part, idx) =>
                        part.isMatch ? (
                          <mark key={idx} className={styles.searchMark}>
                            {part.text}
                          </mark>
                        ) : (
                          part.text
                        ),
                      )}
                    </span>
                  </button>
                </div>

                {isExpanded && (
                  <div className={styles.projectChildren}>
                    {projectSessions.length === 0 ? (
                      <div className={styles.sidebarEmpty}>No chats in this project.</div>
                    ) : (
                      projectSessions.map((session) => {
                        const isSessionActive = session.id === displayActiveSessionId
                        const isMenuOpen = openMenuSession?.sessionId === session.id
                        return (
                          <div
                            key={session.id}
                            className={`${styles.treeSessionRow} ${
                              isSessionActive || isMenuOpen ? styles.active : ""
                            }`}
                            title={`${session.title} · ${project.name}`}
                            onClick={() => {
                              closeCustomize()
                              selectSession(session.id)
                            }}
                            onMouseEnter={handleSessionMouseEnter}
                            onMouseLeave={handleSessionMouseLeave}
                          >
                            <span className={styles.treeSessionCopy}>
                              {/* window.prompt is not supported in Electron, rename inline */}
                              {editingSessionId === session.id ? (
                                <input
                                  className={styles.renameInput}
                                  aria-label="Chat title"
                                  autoFocus
                                  defaultValue={session.title}
                                  onClick={(e) => e.stopPropagation()}
                                  onFocus={(e) => e.currentTarget.select()}
                                  onKeyDown={(e) => {
                                    // Enter also confirms an IME candidate (Vietnamese, CJK), not the rename
                                    if (e.nativeEvent.isComposing) return
                                    if (e.key === "Escape") e.currentTarget.value = session.title
                                    if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur()
                                  }}
                                  onBlur={(e) => {
                                    setEditingSessionId(null)
                                    const title = e.currentTarget.value.trim()
                                    if (title && title !== session.title) void renameSession(session.id, title)
                                  }}
                                />
                              ) : (
                                <span className={styles.treeSessionTitle}>
                                  {splitHighlightParts(session.title, query).map((part, idx) =>
                                    part.isMatch ? (
                                      <mark key={idx} className={styles.searchMark}>
                                        {part.text}
                                      </mark>
                                    ) : (
                                      part.text
                                    ),
                                  )}
                                </span>
                              )}
                            </span>
                            <span
                              className={`${styles.sessionActions} ${
                                isMenuOpen ? styles.menuOpen : ""
                              }`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                className={styles.sessionMoreButton}
                                title="More options"
                                aria-label={`More options for ${session.title}`}
                                aria-expanded={isMenuOpen}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (isMenuOpen) {
                                    setOpenMenuSession(null)
                                    return
                                  }
                                  const rect = e.currentTarget.getBoundingClientRect()
                                  setOpenMenuSession({
                                    sessionId: session.id,
                                    top: rect.bottom + 4,
                                    left: rect.left,
                                  })
                                }}
                              >
                                <svg viewBox="0 0 16 16" fill="currentColor">
                                  <circle cx="3.2" cy="8" r="1.25" />
                                  <circle cx="8" cy="8" r="1.25" />
                                  <circle cx="12.8" cy="8" r="1.25" />
                                </svg>
                              </button>
                            </span>
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </section>
            )
          })
        )}
      </div>

      {openMenuSession && (
        <div
          ref={sessionMenuRef}
          className={styles.sessionContextMenu}
          style={{
            top: `${openMenuSession.top}px`,
            left: `${openMenuSession.left}px`,
          }}
        >
          <button
            type="button"
            className={styles.sessionMenuItem}
            onClick={() => {
              setEditingSessionId(openMenuSession.sessionId)
              setOpenMenuSession(null)
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M10.9 2.4a1.5 1.5 0 0 1 2.1 2.1L6.1 11.4l-3 .7.7-3zM9.8 3.4l2.8 2.8"
                stroke="currentColor"
                strokeWidth="1.35"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Rename</span>
          </button>

          <button
            type="button"
            className={`${styles.sessionMenuItem} ${styles.sessionMenuDelete}`}
            onClick={() => {
              const targetId = openMenuSession.sessionId
              setOpenMenuSession(null)
              void deleteSession(targetId).then((deleted) => {
                if (deleted) clearSessionRuntime(targetId)
              })
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 4.5h10M6 4.5V3h4v1.5M5 4.5l.5 8h5l.5-8M7 7v3.5M9 7v3.5"
                stroke="currentColor"
                strokeWidth="1.35"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Delete</span>
          </button>
        </div>
      )}
    </div>
  )
}
