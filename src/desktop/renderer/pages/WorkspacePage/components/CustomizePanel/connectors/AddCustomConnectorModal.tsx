import type { FormEvent } from "react"
import styles from "../CustomizePanel.module.scss"

interface AddCustomConnectorModalProps {
  name: string
  url: string
  onChangeName: (value: string) => void
  onChangeUrl: (value: string) => void
  onClose: () => void
  onSubmit: (event: FormEvent) => void
}

export function AddCustomConnectorModal({
  name,
  url,
  onChangeName,
  onChangeUrl,
  onClose,
  onSubmit,
}: AddCustomConnectorModalProps) {
  return (
    <div className={styles.modalBackdrop} onClick={onClose} role="presentation">
      <form
        className={styles.modalCard}
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
      >
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Add custom connector</h2>
          <button
            type="button"
            className={styles.modalCloseBtn}
            aria-label="Close modal"
            onClick={onClose}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M3.5 3.5l9 9M12.5 3.5l-9 9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <p className={styles.modalLead}>
          Connect C-Codex to your data and tools.{" "}
          <a href="https://modelcontextprotocol.io" target="_blank" rel="noreferrer">
            Learn more about connectors
          </a>{" "}
          or get started with{" "}
          <a href="https://registry.modelcontextprotocol.io" target="_blank" rel="noreferrer">
            pre-built ones
          </a>
          .
        </p>

        <div className={styles.formGroup}>
          <input
            className={styles.modalInput}
            placeholder="Name"
            value={name}
            onChange={(e) => onChangeName(e.target.value)}
            autoFocus
          />
          <p className={styles.fieldHint}>Shown in the connectors list.</p>
        </div>

        <div className={styles.formGroup}>
          <input
            className={styles.modalInput}
            placeholder="MCP server URL"
            value={url}
            onChange={(e) => onChangeUrl(e.target.value)}
          />
          <p className={styles.fieldHint}>
            The HTTPS address where the server accepts MCP requests, for example
            https://mcp.example.com/mcp.
          </p>
        </div>

        <p className={styles.modalDisclaimer}>
          Only use connectors from developers you trust. C-Codex does not control which tools
          developers make available and cannot verify that they will work as intended or that they
          won&apos;t change.
        </p>

        <p className={styles.modalReportLine}>
          Building an MCP server?{" "}
          <a
            href="https://github.com/modelcontextprotocol/registry/issues"
            target="_blank"
            rel="noreferrer"
          >
            Report issues and subscribe to updates here
          </a>
        </p>

        <div className={styles.modalFooter}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={styles.continueBtn}
            disabled={!name.trim() || !url.trim()}
          >
            Continue
          </button>
        </div>
      </form>
    </div>
  )
}
