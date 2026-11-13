import type { RefObject } from "react"
import type { McpConnectorItem } from "../../../../../../../contracts/mcp-registry"
import styles from "../CustomizePanel.module.scss"
import { ConnectorCard } from "./ConnectorCard"

interface ConnectorsTabViewProps {
  subTab: "yours" | "discover"
  discoverItems: McpConnectorItem[]
  filteredYourItems: McpConnectorItem[]
  isLoadingInitial: boolean
  isLoadingMore: boolean
  loadError: string | null
  nextCursor: string | null
  sentinelRef: RefObject<HTMLDivElement | null>
  isConnectorAdded: (serverName: string) => boolean
  onOpenDetail: (item: McpConnectorItem) => void
  onToggleConnect: (item: McpConnectorItem) => void
}

export function ConnectorsTabView({
  subTab,
  discoverItems,
  filteredYourItems,
  isLoadingInitial,
  isLoadingMore,
  loadError,
  nextCursor,
  sentinelRef,
  isConnectorAdded,
  onOpenDetail,
  onToggleConnect,
}: ConnectorsTabViewProps) {
  if (subTab === "yours") {
    if (filteredYourItems.length === 0) {
      return (
        <div className={styles.skillsNoticeCard}>
          <h3 className={styles.skillsNoticeTitle}>No connectors added yet</h3>
          <p className={styles.skillsNoticeText}>
            Switch to Discover to browse MCP connectors or click &quot;+ Add&quot; to add a custom
            connector.
          </p>
        </div>
      )
    }

    return (
      <div className={styles.connectorGrid}>
        {filteredYourItems.map((item) => (
          <ConnectorCard
            key={item.id}
            item={item}
            isAdded
            onOpenDetail={onOpenDetail}
            onToggleConnect={onToggleConnect}
          />
        ))}
      </div>
    )
  }

  if (isLoadingInitial) {
    return (
      <div className={styles.loadMoreStatus}>
        <span className={styles.spinner} />
        <span>Loading MCP connectors from registry…</span>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className={styles.skillsNoticeCard}>
        <h3 className={styles.skillsNoticeTitle}>Unable to load MCP connectors</h3>
        <p className={styles.skillsNoticeText}>{loadError}</p>
      </div>
    )
  }

  if (discoverItems.length === 0) {
    return (
      <div className={styles.skillsNoticeCard}>
        <h3 className={styles.skillsNoticeTitle}>No connectors found</h3>
        <p className={styles.skillsNoticeText}>
          Try searching with another keyword or add a custom connector.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className={styles.connectorGrid}>
        {discoverItems.map((item) => (
          <ConnectorCard
            key={item.id}
            item={item}
            isAdded={isConnectorAdded(item.serverName)}
            onOpenDetail={onOpenDetail}
            onToggleConnect={onToggleConnect}
          />
        ))}
      </div>

      <div ref={sentinelRef} className={styles.loadMoreStatus}>
        {isLoadingMore ? (
          <>
            <span className={styles.spinner} />
            <span>Loading more connectors…</span>
          </>
        ) : nextCursor ? (
          <span>Scroll down to load more</span>
        ) : (
          <span>All connectors loaded</span>
        )}
      </div>
    </>
  )
}
