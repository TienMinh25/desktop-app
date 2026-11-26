import { useRef, useState, type KeyboardEvent } from "react"
import type { ApprovalMode } from "../../../../../../contracts/permissions"
import { useClickOutside } from "../../../../hooks/useClickOutside"
import { useChatStore, useProjectStore, usePromptSettingsStore } from "../../../../stores"
import { canManageQueuedPrompt } from "../../../../stores/workspace/chat.store"
import { ApprovalModeMenu } from "./components/ApprovalModeMenu"
import { FolderSelectorMenu } from "./components/FolderSelectorMenu"
import { FullAccessModal } from "./components/FullAccessModal"
import { MessageQueueList } from "./components/MessageQueueList"
import { ModelEffortSelector } from "./components/ModelEffortSelector"
import styles from "./PromptBar.module.scss"

export function PromptBar() {
  const [promptText, setPromptText] = useState("")
  const selectedModel = usePromptSettingsStore((state) => state.selectedModel)
  const selectedEffort = usePromptSettingsStore((state) => state.selectedEffort)
  const approvalMode = usePromptSettingsStore((state) => state.approvalMode)
  const skipFullAccessWarning = usePromptSettingsStore((state) => state.skipFullAccessWarning)
  const selectedFolder = usePromptSettingsStore((state) => state.selectedFolder)
  const recentFolders = usePromptSettingsStore((state) => state.recentFolders)
  const {
    setSelectedModel,
    setSelectedEffort,
    setApprovalMode,
    setSkipFullAccessWarning,
    selectFolder,
    clearSelectedFolder,
  } = usePromptSettingsStore((state) => state.actions)

  const selectedProjectId = useProjectStore((state) => state.selectedProjectId)
  const activeSessionId = useProjectStore((state) => state.activeSessionId)
  const { createSessionForPrompt } = useProjectStore((state) => state.actions)
  const turns = useChatStore((state) => state.turns)
  const queuedPrompts = useChatStore((state) => state.queuedPrompts)
  const { sendPrompt, stopGeneration, sendQueuedPromptNow, deleteQueuedPrompt } =
    useChatStore((state) => state.actions)

  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false)
  const [isFullAccessModalOpen, setIsFullAccessModalOpen] = useState(false)
  const [dontWarnAgain, setDontWarnAgain] = useState(false)

  const isCreatingSessionRef = useRef(false)
  const attachMenuRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useClickOutside(attachMenuRef, () => setIsAttachMenuOpen(false))

  const sessionKey = activeSessionId ? String(activeSessionId) : ""
  const activeTurn = sessionKey ? turns[sessionKey] : undefined
  const isStreaming = Boolean(activeTurn?.isStreaming)
  const activeQueue = sessionKey ? (queuedPrompts[sessionKey] ?? []) : []
  const hasPromptText = promptText.trim().length > 0
  const showPauseButton = isStreaming && Boolean(activeSessionId) && !hasPromptText

  const submitPrompt = async () => {
    const prompt = promptText.trim()
    if (!prompt || isCreatingSessionRef.current) return

    let targetSessionId = activeSessionId
    if (!targetSessionId) {
      if (!selectedProjectId) return
      isCreatingSessionRef.current = true
      try {
        targetSessionId = await createSessionForPrompt(selectedProjectId, prompt)
      } finally {
        isCreatingSessionRef.current = false
      }
      if (!targetSessionId) return
    }

    setPromptText("")
    sendPrompt({
      sessionId: String(targetSessionId),
      prompt,
      model: selectedModel,
      workspacePath: selectedFolder?.path,
      approvalMode,
    })
  }

  const handleSelectApprovalMode = (mode: ApprovalMode) => {
    if (mode === "full-access" && approvalMode !== "full-access" && !skipFullAccessWarning) {
      setDontWarnAgain(false)
      setIsFullAccessModalOpen(true)
      return
    }
    setApprovalMode(mode)
  }

  const handleConfirmFullAccess = () => {
    if (dontWarnAgain) {
      setSkipFullAccessWarning(true)
    }
    setApprovalMode("full-access")
    setIsFullAccessModalOpen(false)
  }

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void submitPrompt()
    }
  }

  const handleAttachMock = (attachmentType: "file" | "folder") => {
    alert(`Attached: ${attachmentType === "file" ? "service.go" : "internal/refund/"}`)
    setIsAttachMenuOpen(false)
  }

  return (
    <div className={styles.promptFooter}>
      <div className={styles.promptContainer}>
        {/* Unified Queue + Input Card */}
        <div className={styles.promptCard}>
          {activeQueue.length > 0 && activeSessionId && (
            <MessageQueueList
              items={activeQueue}
              canManageItem={(item) => canManageQueuedPrompt(sessionKey, item)}
              onSendNow={(requestId) => sendQueuedPromptNow(sessionKey, requestId)}
              onEdit={(item) => {
                const queuedItem = useChatStore.getState().queuedPrompts[sessionKey]?.find(
                  (queued) => queued.requestId === item.requestId,
                )
                if (!queuedItem || !canManageQueuedPrompt(sessionKey, queuedItem)) return
                setPromptText(queuedItem.prompt)
                deleteQueuedPrompt(sessionKey, item.requestId)
                requestAnimationFrame(() => {
                  const el = textareaRef.current
                  if (!el) return
                  el.focus()
                  el.setSelectionRange(el.value.length, el.value.length)
                })
              }}
              onDelete={(requestId) => deleteQueuedPrompt(sessionKey, requestId)}
            />
          )}

          <textarea
            ref={textareaRef}
            className={styles.promptTextarea}
            placeholder={
              isStreaming
                ? "Type next message (Enter sends or queues while streaming)..."
                : "Reply or assign next task. Type @ to attach files"
            }
            rows={2}
            value={promptText}
            onChange={(event) => setPromptText(event.target.value)}
            onKeyDown={handleTextareaKeyDown}
          />

          <div className={styles.promptToolbar}>
            <div className={styles.toolbarLeftGroup}>
              <div className={styles.attachMenuContainer} ref={attachMenuRef}>
                <button
                  type="button"
                  className={styles.attachButton}
                  onClick={() => setIsAttachMenuOpen((prev) => !prev)}
                  title="Add files or folders"
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M8 3v10M3 8h10"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>

                {isAttachMenuOpen && (
                  <div className={styles.attachDropdown}>
                    <button
                      type="button"
                      className={styles.attachOption}
                      onClick={() => handleAttachMock("file")}
                    >
                      <span>📄 Add files...</span>
                    </button>
                    <button
                      type="button"
                      className={styles.attachOption}
                      onClick={() => handleAttachMock("folder")}
                    >
                      <span>📁 Add folder...</span>
                    </button>
                  </div>
                )}
              </div>

              <ApprovalModeMenu approvalMode={approvalMode} onSelectMode={handleSelectApprovalMode} />
            </div>

            <div className={styles.toolbarActions}>
              <ModelEffortSelector
                selectedModel={selectedModel}
                selectedEffort={selectedEffort}
                onSelectModel={setSelectedModel}
                onSelectEffort={setSelectedEffort}
              />

              {showPauseButton ? (
                <button
                  type="button"
                  className={`${styles.sendButton} ${styles.pauseButton}`}
                  onClick={() => stopGeneration(sessionKey)}
                  title="Stop generation"
                  aria-label="Stop generation"
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1.4" fill="currentColor" />
                  </svg>
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.sendButton}
                  onClick={() => void submitPrompt()}
                  title="Send prompt"
                  aria-label="Send prompt"
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M8 13V3M3 8l5-5 5 5"
                      stroke="white"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        <FolderSelectorMenu
          selectedFolder={selectedFolder}
          recentFolders={recentFolders}
          onSelectFolder={selectFolder}
          onClearFolder={clearSelectedFolder}
        />
      </div>

      <FullAccessModal
        isOpen={isFullAccessModalOpen}
        dontWarnAgain={dontWarnAgain}
        onDontWarnAgainChange={setDontWarnAgain}
        onCancel={() => setIsFullAccessModalOpen(false)}
        onConfirm={handleConfirmFullAccess}
      />
    </div>
  )
}
