import type { McpConnectorItem } from "../../../../../../../contracts/mcp-registry"
import styles from "../CustomizePanel.module.scss"
import { ConnectorCard } from "./ConnectorCard"
import { ConnectorIcon, formatAddedDate, VerifiedBadge } from "./ConnectorIcon"

interface ConnectorDetailViewProps {
  connector: McpConnectorItem
  isLoadingDetail: boolean
  relatedConnectors: McpConnectorItem[]
  isConnectorAdded: (serverName: string) => boolean
  onBack: () => void
  onToggleConnect: (item: McpConnectorItem) => void
  onOpenDetail: (item: McpConnectorItem) => void
}

export function ConnectorDetailView({
  connector,
  isLoadingDetail,
  relatedConnectors,
  isConnectorAdded,
  onBack,
  onToggleConnect,
  onOpenDetail,
}: ConnectorDetailViewProps) {
  const isConnected = isConnectorAdded(connector.serverName)

  return (
    <div className={styles.detailWrap}>
      <button type="button" className={styles.backLink} onClick={onBack}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <path
            d="M12.5 8h-9M7 4.5L3.5 8 7 11.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>Connectors</span>
      </button>

      <div className={styles.detailHeader}>
        <div className={styles.detailHeaderLeft}>
          <ConnectorIcon item={connector} className={styles.detailIconBox} />
          <div className={styles.detailTitleBlock}>
            <div className={styles.detailTitleRow}>
              <h1 className={styles.detailTitle}>{connector.title}</h1>
              <VerifiedBadge />
            </div>
            <p className={styles.detailSubtitle}>{connector.description}</p>
          </div>
        </div>

        <button
          type="button"
          className={`${styles.connectButton} ${isConnected ? styles.connectedState : ""}`}
          onClick={() => onToggleConnect(connector)}
        >
          {isConnected ? "Connected" : "Connect"}
        </button>
      </div>

      <div className={styles.detailColumns}>
        <div className={styles.detailMainCol}>
          <p className={styles.detailLongDesc}>
            {connector.description}
            {connector.description.length < 140
              ? ` Connect ${connector.title} to C-Codex to search, read, and interact with your data and tools directly inside your workspace.`
              : ""}
          </p>

          <div>
            <h2 className={styles.toolsSectionTitle}>
              Tools {isLoadingDetail ? "· Loading…" : ""}
            </h2>
            <div className={styles.toolsGrid}>
              {connector.tools.map((toolName) => (
                <span key={toolName} className={styles.toolBadge} title={toolName}>
                  {toolName}
                </span>
              ))}
            </div>
          </div>

          <div className={styles.trustNoticeBox}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.3" />
              <path
                d="M8 7.2v3.6M8 5.1h.01"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
            <span>
              Only use connectors from developers you trust. C-Codex does not control which tools
              developers make available and cannot verify that they will work as intended or that
              they won&apos;t change.
            </span>
          </div>
        </div>

        <aside className={styles.detailMetaCol}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>MADE BY</span>
            {connector.authorUrl ? (
              <a
                className={styles.metaLink}
                href={connector.authorUrl}
                target="_blank"
                rel="noreferrer"
              >
                <span>{connector.author}</span>
                <span>↗</span>
              </a>
            ) : (
              <span className={styles.metaValue}>{connector.author}</span>
            )}
          </div>

          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>CATEGORY</span>
            <span className={styles.categoryPill}>{connector.category}</span>
          </div>

          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>SIGN-IN</span>
            <span className={styles.metaValue}>
              {connector.signInRequired ? "Required" : "Optional"}
            </span>
          </div>

          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>CONNECTOR URL</span>
            <span className={styles.metaUrlValue}>{connector.connectorUrl}</span>
          </div>

          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>ADDED</span>
            <span className={styles.metaValue}>
              {formatAddedDate(connector.publishedAt || connector.updatedAt)}
            </span>
          </div>

          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>MORE INFO</span>
            <div className={styles.moreInfoLinks}>
              <a
                className={styles.metaLink}
                href={
                  connector.websiteUrl ||
                  connector.repositoryUrl ||
                  "https://modelcontextprotocol.io"
                }
                target="_blank"
                rel="noreferrer"
              >
                <span>Documentation</span>
                <span>↗</span>
              </a>
              <a
                className={styles.metaLink}
                href={
                  connector.repositoryUrl ||
                  connector.websiteUrl ||
                  "https://modelcontextprotocol.io"
                }
                target="_blank"
                rel="noreferrer"
              >
                <span>Support</span>
                <span>↗</span>
              </a>
              <a
                className={styles.metaLink}
                href={
                  connector.websiteUrl ||
                  connector.repositoryUrl ||
                  "https://modelcontextprotocol.io"
                }
                target="_blank"
                rel="noreferrer"
              >
                <span>Privacy Policy</span>
                <span>↗</span>
              </a>
            </div>
          </div>
        </aside>
      </div>

      {relatedConnectors.length > 0 && (
        <div className={styles.relatedSection}>
          <h2 className={styles.relatedTitle}>Related connectors</h2>
          <div className={styles.connectorGrid}>
            {relatedConnectors.map((rel) => (
              <ConnectorCard
                key={rel.id}
                item={rel}
                isAdded={isConnectorAdded(rel.serverName)}
                onOpenDetail={onOpenDetail}
                onToggleConnect={onToggleConnect}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
