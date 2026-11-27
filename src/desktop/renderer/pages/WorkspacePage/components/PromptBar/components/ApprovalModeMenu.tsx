import { useRef, useState } from "react"
import type { ApprovalMode } from "../../../../../../../contracts/permissions"
import { useClickOutside } from "../../../../../hooks/useClickOutside"
import styles from "../PromptBar.module.scss"

const APPROVAL_MODE_OPTIONS: ReadonlyArray<{
  value: ApprovalMode
  label: string
  description: string
  isDanger?: boolean
}> = [
  {
    value: "manual",
    label: "Ask for approval",
    description: "Always ask to edit external files and use the internet",
  },
  {
    value: "auto-safe",
    label: "Approve for me",
    description: "Only ask for actions detected as potentially unsafe",
  },
  {
    value: "full-access",
    label: "Full access",
    description: "Unrestricted access to the internet and any file on your computer",
    isDanger: true,
  },
]

function ApprovalModeIcon({ mode }: { mode: ApprovalMode }) {
  if (mode === "manual") {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M8 2.2v5.3M5.6 3.5v4.2M10.4 3.7v4M3.5 6.8v2.7a4.5 4.5 0 0 0 9 0V6.3"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (mode === "auto-safe") {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="5.8" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2.2 1.6" />
        <path
          d="M8 5v3.2l2.1 1.2"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.8" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 4.8v3.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.2" r="0.8" fill="currentColor" />
    </svg>
  )
}

interface ApprovalModeMenuProps {
  approvalMode: ApprovalMode
  onSelectMode: (mode: ApprovalMode) => void
}

export function ApprovalModeMenu({ approvalMode, onSelectMode }: ApprovalModeMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useClickOutside(containerRef, () => setIsOpen(false))

  const selectedOption =
    APPROVAL_MODE_OPTIONS.find((item) => item.value === approvalMode) ?? APPROVAL_MODE_OPTIONS[0]!

  return (
    <div className={styles.approvalMenuContainer} ref={containerRef}>
      <button
        type="button"
        className={`${styles.approvalTriggerButton} ${
          approvalMode === "full-access" ? styles.approvalTriggerDanger : ""
        } ${isOpen ? styles.approvalTriggerActive : ""}`}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-label="Approval mode"
        title="Choose how C-CodeX actions are approved"
      >
        <ApprovalModeIcon mode={approvalMode} />
        <span>{selectedOption.label}</span>
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className={styles.chevronIcon}>
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {isOpen && (
        <div className={styles.approvalPopover} role="menu" aria-label="Approval options">
          <div className={styles.approvalPopoverHeader}>
            <span>How should C-CodeX actions be approved?</span>
          </div>
          {APPROVAL_MODE_OPTIONS.map((option) => {
            const isSelected = approvalMode === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                className={`${styles.approvalOptionItem} ${
                  option.isDanger ? styles.approvalOptionDanger : ""
                } ${isSelected ? styles.approvalOptionSelected : ""}`}
                onClick={() => {
                  setIsOpen(false)
                  onSelectMode(option.value)
                }}
              >
                <span className={styles.approvalOptionIcon}>
                  <ApprovalModeIcon mode={option.value} />
                </span>
                <span className={styles.approvalOptionContent}>
                  <span className={styles.approvalOptionTitle}>{option.label}</span>
                  <span className={styles.approvalOptionDescription}>{option.description}</span>
                </span>
                {isSelected && (
                  <svg className={styles.approvalCheckIcon} width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M3 8.5l3.2 3.2L13 5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
