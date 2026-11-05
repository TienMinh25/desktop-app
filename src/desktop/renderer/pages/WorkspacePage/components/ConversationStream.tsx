import styles from "./ConversationStream.module.scss"

interface ConversationStreamProps {
  onShowToast: (message: string) => void
}

export function ConversationStream({ onShowToast }: ConversationStreamProps) {
  const handleCopyResponse = async () => {
    const text = [
      "I will inspect the existing refund handling code first.",
      "Currently the service only supports full refund (Refund). Implementing in 4 steps:",
      "Service logic is ready. PartialRefund validates negative amounts and amounts exceeding remaining balance; all 6/6 tests passed. Route in handler.go is not yet wired, would you like me to connect it now?",
    ].join("\n\n")

    try {
      await navigator.clipboard.writeText(text)
      onShowToast("Response copied to clipboard.")
    } catch {
      onShowToast("Response copied to clipboard.")
    }
  }

  return (
    <div className={styles.chatScrollArea}>
      {/* User Prompt */}
      <div className={styles.msgUserRow}>
        <div className={styles.msgUserBubble}>
          Add API for partial refund on paid orders. The refund amount cannot exceed paid amount
          minus already refunded amount. Write tests as well.
        </div>
      </div>

      {/* AI Coding Agent Response */}
      <div className={styles.msgAiRow}>
        <div className={styles.responseIntroRow}>
          <p>I will inspect the existing refund handling code first.</p>
        </div>

        {/* Tool Action line */}
        <div className={styles.agentStatusLine}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path
              d="M6 3l5 5-5 5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>Read 3 files, performed 1 search</span>
        </div>

        <div className={styles.assistantCopyText}>
          Currently the service only supports full refund (
          <code className={styles.inlineCode}>Refund</code>). Implementing in 4 steps:
        </div>

        {/* Plan / Tasks Checklist Card */}
        <div className={styles.tasksCard}>
          <div className={styles.tasksCardHeader}>
            <span>Tasks</span>
            <span className={styles.tasksProgress}>3/4</span>
          </div>

          <div className={styles.taskItem}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" fill="#10B981" />
              <path
                d="M5 8l2 2 4-4"
                stroke="#fff"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Add PartialRefund to service</span>
          </div>

          <div className={styles.taskItem}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" fill="#10B981" />
              <path
                d="M5 8l2 2 4-4"
                stroke="#fff"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Write test suite for boundary edge cases</span>
          </div>

          <div className={styles.taskItem}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" fill="#10B981" />
              <path
                d="M5 8l2 2 4-4"
                stroke="#fff"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Run refund package test suite</span>
          </div>

          <div className={`${styles.taskItem} ${styles.pending}`}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            <span>Connect partial refund routing in handler</span>
          </div>
        </div>

        {/* File Action: Edit */}
        <div className={styles.fileActionChip}>
          <div className={styles.fileActionLeft}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M11 2l3 3-9 9H2v-3l9-9z" stroke="#38BDF8" strokeWidth="1.4" />
            </svg>
            <span>
              Edit <strong>internal/refund/service.go</strong>
            </span>
          </div>
          <div className={styles.diffBadge}>
            <span className={styles.diffAdd}>+24</span>
            <span className={styles.diffDel}>-3</span>
          </div>
        </div>

        {/* File Action: Create */}
        <div className={styles.fileActionChip}>
          <div className={styles.fileActionLeft}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect
                x="3"
                y="2"
                width="10"
                height="12"
                rx="1.5"
                stroke="#10B981"
                strokeWidth="1.4"
              />
              <path
                d="M6 6h4M6 9h4"
                stroke="#10B981"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
            <span>
              Create <strong>internal/refund/service_partial_test.go</strong>
            </span>
          </div>
          <div className={styles.diffBadge}>
            <span className={styles.diffAdd}>+58</span>
          </div>
        </div>

        {/* Command Execution */}
        <div className={styles.cmdExecBox}>
          <div className={styles.cmdLeft}>
            <span className={styles.cmdPrompt}>&gt;_</span>
            <span>go test ./internal/refund/... -run Partial -count=1</span>
          </div>
          <div className={styles.cmdPass}>
            <span>✓ 6/6 passed (3.1s)</span>
          </div>
        </div>

        {/* Final Summary Text */}
        <div className={styles.summaryText}>
          Service logic is ready. <code className={styles.inlineCode}>PartialRefund</code> validates
          negative amounts and amounts exceeding remaining balance; all 6/6 tests passed. Route in{" "}
          <code className={styles.inlineCode}>handler.go</code> is not yet wired, would you like me
          to connect it now?
        </div>

        <div className={styles.responseActionRow}>
          <button
            className={styles.copyResponseButton}
            type="button"
            onClick={handleCopyResponse}
            title="Copy response"
            aria-label="Copy response"
          >
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect
                x="5.2"
                y="5.2"
                width="8"
                height="9"
                rx="1.4"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <path
                d="M10.2 5.2V4A1.5 1.5 0 0 0 8.7 2.5H4A1.5 1.5 0 0 0 2.5 4v6.7A1.3 1.3 0 0 0 3.8 12h1.4"
                stroke="currentColor"
                strokeWidth="1.2"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}