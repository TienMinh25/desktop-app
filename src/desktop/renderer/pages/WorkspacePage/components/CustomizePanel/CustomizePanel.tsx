import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type UIEvent } from "react"
import type { McpConnectorItem } from "../../../../../../contracts/mcp-registry"
import { useClickOutside } from "../../../../hooks/useClickOutside"
import { AddCustomConnectorModal } from "./connectors/AddCustomConnectorModal"
import { ConnectorDetailView } from "./connectors/ConnectorDetailView"
import { ConnectorsTabView } from "./connectors/ConnectorsTabView"
import styles from "./CustomizePanel.module.scss"
import { SkillsTabView } from "./skills/SkillsTabView"

interface CustomizePanelProps {
  onShowToast: (message: string) => void
}

type MainTab = "skills" | "connectors"
type ConnectorSubTab = "yours" | "discover"

export function CustomizePanel({ onShowToast }: CustomizePanelProps) {
  const [mainTab, setMainTab] = useState<MainTab>("connectors")
  const [subTab, setSubTab] = useState<ConnectorSubTab>("discover")
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")

  const [discoverItems, setDiscoverItems] = useState<McpConnectorItem[]>([])
  const [yourItems, setYourItems] = useState<McpConnectorItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [isLoadingInitial, setIsLoadingInitial] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [selectedConnector, setSelectedConnector] = useState<McpConnectorItem | null>(null)
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)

  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false)
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false)
  const [customName, setCustomName] = useState("")
  const [customUrl, setCustomUrl] = useState("")

  const addMenuRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadingCursorRef = useRef<string | null>(null)

  useClickOutside(addMenuRef, () => setIsAddMenuOpen(false))

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchQuery.trim())
    }, 320)
    return () => window.clearTimeout(timer)
  }, [searchQuery])

  const fetchInitialServers = useCallback(async (search: string) => {
    setIsLoadingInitial(true)
    setLoadError(null)
    loadingCursorRef.current = null
    try {
      const response = await window.desktop.listMcpServers({
        limit: 20,
        version: "latest",
        search: search || undefined,
      })
      setDiscoverItems(response.items)
      setNextCursor(response.nextCursor)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load MCP connectors")
    } finally {
      setIsLoadingInitial(false)
    }
  }, [])

  useEffect(() => {
    void fetchInitialServers(debouncedSearch)
  }, [debouncedSearch, fetchInitialServers])

  const loadMoreServers = useCallback(async () => {
    if (!nextCursor || isLoadingInitial || isLoadingMore) return
    if (loadingCursorRef.current === nextCursor) return

    loadingCursorRef.current = nextCursor
    setIsLoadingMore(true)
    try {
      const response = await window.desktop.listMcpServers({
        cursor: nextCursor,
        limit: 20,
        version: "latest",
        search: debouncedSearch || undefined,
      })
      setDiscoverItems((prev) => {
        const existingNames = new Set(prev.map((item) => item.serverName))
        const appended = response.items.filter((item) => !existingNames.has(item.serverName))
        return [...prev, ...appended]
      })
      setNextCursor(response.nextCursor)
    } catch (err) {
      loadingCursorRef.current = null
      onShowToast(err instanceof Error ? err.message : "Could not load more connectors")
    } finally {
      setIsLoadingMore(false)
    }
  }, [nextCursor, isLoadingInitial, isLoadingMore, debouncedSearch, onShowToast])

  useEffect(() => {
    if (mainTab !== "connectors" || subTab !== "discover" || selectedConnector) return
    const sentinel = sentinelRef.current
    const root = scrollContainerRef.current
    if (!sentinel || !root) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadMoreServers()
        }
      },
      { root, rootMargin: "240px" },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [mainTab, subTab, selectedConnector, loadMoreServers])

  const handleContainerScroll = (event: UIEvent<HTMLDivElement>) => {
    if (mainTab !== "connectors" || subTab !== "discover" || selectedConnector) return
    const target = event.currentTarget
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight
    if (distanceToBottom < 240) {
      void loadMoreServers()
    }
  }

  const handleOpenConnectorDetail = async (connector: McpConnectorItem) => {
    setSelectedConnector(connector)
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" })
    if (connector.isCustom) return

    setIsLoadingDetail(true)
    try {
      const targetVersion = connector.version || "latest"
      const detail = await window.desktop.getMcpServerVersion(
        connector.serverName,
        targetVersion,
      )
      setSelectedConnector((current) =>
        current && current.serverName === connector.serverName ? detail : current,
      )
    } catch {
      // Keep the list item metadata if specific version endpoint fails
    } finally {
      setIsLoadingDetail(false)
    }
  }

  const isConnectorAdded = useCallback(
    (serverName: string) => yourItems.some((item) => item.serverName === serverName),
    [yourItems],
  )

  const handleToggleConnector = (connector: McpConnectorItem) => {
    const exists = isConnectorAdded(connector.serverName)
    if (exists) {
      setYourItems((prev) => prev.filter((item) => item.serverName !== connector.serverName))
      onShowToast(`Removed ${connector.title} from your connectors`)
    } else {
      setYourItems((prev) => [connector, ...prev])
      onShowToast(`Connected ${connector.title}`)
    }
  }

  const handleCreateCustomConnector = (event: FormEvent) => {
    event.preventDefault()
    const trimmedName = customName.trim()
    const trimmedUrl = customUrl.trim()
    if (!trimmedName || !trimmedUrl) return

    const slug = trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "custom"
    const customItem: McpConnectorItem = {
      id: `custom/${slug}@latest`,
      serverName: `custom/${slug}-${Date.now()}`,
      version: "1.0.0",
      title: trimmedName,
      description: `Custom MCP server endpoint at ${trimmedUrl}`,
      author: "Custom",
      category: "Remote connector",
      signInRequired: true,
      connectorUrl: trimmedUrl,
      publishedAt: new Date().toISOString(),
      websiteUrl: trimmedUrl,
      tools: ["list_tools", "call_tool", "read_resource"],
      isCustom: true,
    }

    setYourItems((prev) => [customItem, ...prev])
    setCustomName("")
    setCustomUrl("")
    setIsCustomModalOpen(false)
    setMainTab("connectors")
    setSubTab("yours")
    onShowToast(`Added custom connector "${trimmedName}"`)
  }

  const filteredYourItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return yourItems
    return yourItems.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.author.toLowerCase().includes(q),
    )
  }, [yourItems, searchQuery])

  const relatedConnectors = useMemo(() => {
    if (!selectedConnector) return []
    return discoverItems
      .filter((item) => item.serverName !== selectedConnector.serverName)
      .slice(0, 2)
  }, [discoverItems, selectedConnector])

  return (
    <div
      ref={scrollContainerRef}
      className={styles.customizeContainer}
      onScroll={handleContainerScroll}
    >
      {selectedConnector ? (
        <ConnectorDetailView
          connector={selectedConnector}
          isLoadingDetail={isLoadingDetail}
          relatedConnectors={relatedConnectors}
          isConnectorAdded={isConnectorAdded}
          onBack={() => setSelectedConnector(null)}
          onToggleConnect={handleToggleConnector}
          onOpenDetail={(item) => void handleOpenConnectorDetail(item)}
        />
      ) : (
        <div className={styles.customizeInner}>
          <h1 className={styles.pageTitle}>Customize</h1>

          <div className={styles.toolbar}>
            <div className={styles.tabsGroup}>
              <button
                type="button"
                className={`${styles.tabButton} ${mainTab === "skills" ? styles.activeTab : ""}`}
                onClick={() => setMainTab("skills")}
              >
                Skills
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${
                  mainTab === "connectors" ? styles.activeTab : ""
                }`}
                onClick={() => setMainTab("connectors")}
              >
                Connectors
              </button>

              <span className={styles.tabDivider} />

              <button
                type="button"
                className={`${styles.tabButton} ${
                  mainTab === "connectors" && subTab === "yours" ? styles.activeTab : ""
                }`}
                onClick={() => {
                  setMainTab("connectors")
                  setSubTab("yours")
                }}
              >
                Yours
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${
                  mainTab === "connectors" && subTab === "discover" ? styles.activeTab : ""
                }`}
                onClick={() => {
                  setMainTab("connectors")
                  setSubTab("discover")
                }}
              >
                Discover
              </button>
            </div>

            <div className={styles.toolbarActions}>
              <div className={styles.searchWrapper}>
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
                  placeholder="Search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div ref={addMenuRef} className={styles.addDropdownWrap}>
                <button
                  type="button"
                  className={styles.addButton}
                  onClick={() => setIsAddMenuOpen((prev) => !prev)}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M8 2.5v11M2.5 8h11"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span>Add</span>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M4 6.5l4 4 4-4"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>

                {isAddMenuOpen && (
                  <div className={styles.addDropdownMenu}>
                    <button
                      type="button"
                      className={styles.addDropdownItem}
                      onClick={() => {
                        setIsAddMenuOpen(false)
                        setIsCustomModalOpen(true)
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <path
                          d="M8 3v10M3 8h10"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                      <span>Add custom connector</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {mainTab === "skills" ? (
            <SkillsTabView />
          ) : (
            <ConnectorsTabView
              subTab={subTab}
              discoverItems={discoverItems}
              filteredYourItems={filteredYourItems}
              isLoadingInitial={isLoadingInitial}
              isLoadingMore={isLoadingMore}
              loadError={loadError}
              nextCursor={nextCursor}
              sentinelRef={sentinelRef}
              isConnectorAdded={isConnectorAdded}
              onOpenDetail={(item) => void handleOpenConnectorDetail(item)}
              onToggleConnect={handleToggleConnector}
            />
          )}
        </div>
      )}

      {isCustomModalOpen && (
        <AddCustomConnectorModal
          name={customName}
          url={customUrl}
          onChangeName={setCustomName}
          onChangeUrl={setCustomUrl}
          onClose={() => setIsCustomModalOpen(false)}
          onSubmit={handleCreateCustomConnector}
        />
      )}
    </div>
  )
}
