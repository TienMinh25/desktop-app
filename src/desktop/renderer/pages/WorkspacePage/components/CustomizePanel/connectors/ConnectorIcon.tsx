import { useEffect, useState } from "react"
import type { McpConnectorItem } from "../../../../../../../contracts/mcp-registry"
import styles from "../CustomizePanel.module.scss"

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #2563eb, #1d4ed8)",
  "linear-gradient(135deg, #7c3aed, #5b21b6)",
  "linear-gradient(135deg, #059669, #047857)",
  "linear-gradient(135deg, #ea580c, #c2410c)",
  "linear-gradient(135deg, #db2777, #9d174d)",
  "linear-gradient(135deg, #0284c7, #0369a1)",
  "linear-gradient(135deg, #4f46e5, #3730a3)",
  "linear-gradient(135deg, #d97706, #b45309)",
]

function getAvatarGradient(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length] ?? AVATAR_GRADIENTS[0]!
}

function getInitials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase()
  }
  return (title.trim().slice(0, 2) || "MC").toUpperCase()
}

export function formatAddedDate(iso?: string): string {
  if (!iso) return "March 2026"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "March 2026"
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date)
}

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
