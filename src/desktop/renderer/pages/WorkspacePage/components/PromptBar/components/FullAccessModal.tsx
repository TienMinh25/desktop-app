import { useRef } from "react"
import { useModalFocusLock } from "../../../../../hooks/useModalFocusLock"
import styles from "../PromptBar.module.scss"

interface FullAccessModalProps {
  isOpen: boolean
  dontWarnAgain: boolean
  onDontWarnAgainChange: (checked: boolean) => void
  onCancel: () => void
  onConfirm: () => void
}

export function FullAccessModal({
  isOpen,
  dontWarnAgain,
  onDontWarnAgainChange,
  onCancel,
  onConfirm,
}: FullAccessModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useModalFocusLock(modalRef, {
    enabled: isOpen,
    initialFocusRef: cancelRef,
    onEscape: onCancel,
  })

  if (!isOpen) return null

  return (
    <div className={styles.fullAccessOverlay} onClick={onCancel}>
      <div
        ref={modalRef}
        className={styles.fullAccessModal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fullAccessTitle"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.fullAccessHeader}>
          <span className={styles.fullAccessBadgeIcon} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 2.2 14.2 13H1.8L8 2.2Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <path d="M8 6.2v3.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <circle cx="8" cy="11.3" r="0.7" fill="currentColor" />
            </svg>
          </span>
          <h2 id="fullAccessTitle" className={styles.fullAccessTitle}>
            Turn on Full Access?
          </h2>
        </div>

        <p className={styles.fullAccessIntro}>
          C-CodeX will be able to run commands, use the internet, and create and edit files
          anywhere on this computer without your permission. This includes but is not limited to:
        </p>

        <div className={styles.fullAccessCapabilities}>
          <div className={styles.fullAccessCapabilityRow}>
            <span className={styles.fullAccessCapIcon} aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M1.8 4.2a1 1 0 0 1 1-1h3l1.3 1.4H13.2a1 1 0 0 1 1 1v6.2a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1V4.2Z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <div>
              <div className={styles.fullAccessCapTitle}>Files and folders</div>
              <div className={styles.fullAccessCapDesc}>
                Read, create, modify, upload, or delete files anywhere on this computer
              </div>
            </div>
          </div>

          <div className={styles.fullAccessCapabilityRow}>
            <span className={styles.fullAccessCapIcon} aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
                <path
                  d="M5 6.5 7 8 5 9.5M8.5 9.5H11"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <div>
              <div className={styles.fullAccessCapTitle}>Terminal commands</div>
              <div className={styles.fullAccessCapDesc}>
                Run commands, install software, and change system settings
              </div>
            </div>
          </div>

          <div className={styles.fullAccessCapabilityRow}>
            <span className={styles.fullAccessCapIcon} aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="5.8" stroke="currentColor" strokeWidth="1.3" />
                <path
                  d="M2.5 8h11M8 2.2c1.6 1.6 2.3 3.6 2.3 5.8S9.6 12.2 8 13.8M8 2.2C6.4 3.8 5.7 5.8 5.7 8s.7 4.2 2.3 5.8"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
            </span>
            <div>
              <div className={styles.fullAccessCapTitle}>Internet and connected apps</div>
              <div className={styles.fullAccessCapDesc}>
                Access websites, send data, and use enabled plugins
              </div>
            </div>
          </div>
        </div>

        <p className={styles.fullAccessRiskNote}>
          This comes with risks like loss or exposure of sensitive data and prompt injection. You
          can turn this off at any time.
        </p>

        <label className={styles.fullAccessCheckboxRow}>
          <input
            type="checkbox"
            checked={dontWarnAgain}
            onChange={(e) => onDontWarnAgainChange(e.target.checked)}
          />
          <span>Don&apos;t warn me again</span>
        </label>

        <div className={styles.fullAccessActions}>
          <button
            ref={cancelRef}
            type="button"
            className={styles.fullAccessCancelBtn}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button type="button" className={styles.fullAccessConfirmBtn} onClick={onConfirm}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M8 2.2 14.2 13H1.8L8 2.2Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path d="M8 6.2v3.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="8" cy="11.3" r="0.7" fill="currentColor" />
            </svg>
            <span>Confirm</span>
          </button>
        </div>
      </div>
    </div>
  )
}
