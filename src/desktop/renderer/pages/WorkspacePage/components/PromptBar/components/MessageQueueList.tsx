import type { QueuedPromptItem } from "../../../../../stores"
import styles from "../PromptBar.module.scss"

interface MessageQueueListProps {
  items: ReadonlyArray<QueuedPromptItem>
  canManageItem: (item: QueuedPromptItem) => boolean
  onSendNow: (requestId: string) => void
  onEdit: (item: QueuedPromptItem) => void
  onDelete: (requestId: string) => void
}

/** Attached queue strip rendered inside the top of the prompt card. */
export function MessageQueueList({
  items,
  canManageItem,
  onSendNow,
  onEdit,
  onDelete,
}: MessageQueueListProps) {
  if (items.length === 0) return null

  return (
    <section className={styles.messageQueueSection} aria-label="Message queue">
      <div className={styles.messageQueueList}>
        {items.map((item, index) => (
          <div key={item.requestId} className={styles.messageQueueItem}>
            <span className={styles.messageQueueIndex}>{index + 1}</span>
            <span className={styles.messageQueueText} title={item.prompt}>
              {item.prompt}
            </span>
            {canManageItem(item) && (
              <div className={styles.messageQueueActions}>
                <button
                  type="button"
                  className={styles.queueIconBtnPrimary}
                  title="Send now"
                  aria-label="Send now"
                  onClick={() => onSendNow(item.requestId)}
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M8 12.5V3.5M4 7.5l4-4 4 4"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  className={styles.queueIconBtn}
                  title="Edit"
                  aria-label="Edit"
                  onClick={() => onEdit(item)}
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M11.2 2.6a1.4 1.4 0 0 1 2 2L6 11.8l-2.8.7.7-2.8 7.3-7.1Z"
                      stroke="currentColor"
                      strokeWidth="1.35"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  className={styles.queueIconBtnDanger}
                  title="Delete"
                  aria-label="Delete"
                  onClick={() => onDelete(item.requestId)}
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M3 4.5h10M6 4.5V3h4v1.5M5 4.5l.5 8h5l.5-8M7 7v3.5M9 7v3.5"
                      stroke="currentColor"
                      strokeWidth="1.35"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
