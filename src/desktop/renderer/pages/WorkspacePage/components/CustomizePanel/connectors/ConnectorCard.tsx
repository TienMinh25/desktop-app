import type { McpConnectorItem } from "../../../../../../../contracts/mcp-registry"
import styles from "../CustomizePanel.module.scss"
import { ConnectorIcon, VerifiedBadge } from "./ConnectorIcon"

interface ConnectorCardProps {
  item: McpConnectorItem
  isAdded: boolean
  onOpenDetail: (item: McpConnectorItem) => void
  onToggleConnect: (item: McpConnectorItem) => void
}

export function ConnectorCard({
  item,
  isAdded,
  onOpenDetail,
  onToggleConnect,
}: ConnectorCardProps) {
  return (
    <div className={styles.connectorCard} onClick={() => onOpenDetail(item)}>
      <ConnectorIcon item={item} className={styles.cardIconBox} />
      <div className={styles.cardBody}>
        <div className={styles.cardTitleRow}>
          <span className={styles.cardTitle}>{item.title}</span>
          <VerifiedBadge />
        </div>
        <p className={styles.cardDesc}>{item.description}</p>
        <span className={styles.cardAuthor}>by {item.author}</span>
      </div>
      <button
        type="button"
        className={`${styles.cardPlusBtn} ${isAdded ? styles.addedBtn : ""}`}
        title={isAdded ? "Connected" : `Add ${item.title}`}
        onClick={(e) => {
          e.stopPropagation()
          onToggleConnect(item)
        }}
      >
        {isAdded ? (
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path
              d="M3.5 8.5l3 3 6-6.5"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 3.2v9.6M3.2 8h9.6"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>
    </div>
  )
}
