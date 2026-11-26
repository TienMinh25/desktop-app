import { useEffect, useState } from "react"
import type { McpConnectorItem } from "../../../../../../../contracts/mcp-registry"
import { getAvatarGradient, getInitials } from "../../../../../utils/text"
import styles from "../CustomizePanel.module.scss"

export function ConnectorIcon({
  item,
  className,
}: {
  item: McpConnectorItem
  className?: string
}) {
  const [imgFailed, setImgFailed] = useState(false)

  useEffect(() => {
    setImgFailed(false)
  }, [item.iconUrl])

  return (
    <div className={className}>
      {item.iconUrl && !imgFailed ? (
        <img
          src={item.iconUrl}
          alt={item.title}
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div
          className={styles.fallbackGlyph}
          style={{ background: getAvatarGradient(item.serverName || item.title) }}
        >
          {getInitials(item.title)}
        </div>
      )}
    </div>
  )
}

export function VerifiedBadge() {
  return (
    <svg className={styles.verifiedIcon} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.5l1.6 1.1 1.9-.2.7 1.8 1.8.7-.2 1.9L14.9 8l-1.1 1.6.2 1.9-1.8.7-.7 1.8-1.9-.2L8 14.9l-1.6-1.1-1.9.2-.7-1.8-1.8-.7.2-1.9L1.1 8l1.1-1.6-.2-1.9 1.8-.7.7-1.8 1.9.2L8 1.5z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M5.7 8.1l1.5 1.5 3.2-3.2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
