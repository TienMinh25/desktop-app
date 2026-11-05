import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import {
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
  MODEL_OPTIONS,
  REASONING_EFFORTS,
  STORAGE_KEYS,
  type ReasoningEffort,
} from "../../../constants"
import { useClickOutside } from "../../../hooks/useClickOutside"
import styles from "./PromptBar.module.scss"

interface PromptBarProps {
  workspaceName?: string
  promptText: string
  onPromptChange: (value: string) => void
  onSendPrompt: (model: string, effort: ReasoningEffort) => void
}

interface FolderItem {
  name: string
  path: string
}

type ModelPopoverTab = "effort" | "models"

const SLIDER_THUMB_SIZE_PX = 28
const SLIDER_THUMB_RADIUS_PX = SLIDER_THUMB_SIZE_PX / 2
const MAX_RECENT_FOLDERS = 5

function loadSavedRecentFolders(): FolderItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.RECENT_FOLDERS)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is FolderItem =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as FolderItem).name === "string" &&
        typeof (item as FolderItem).path === "string" &&
        (item as FolderItem).path !== "Local",
    )
  } catch {
    return []
  }
}

export function PromptBar({
  promptText,
  onPromptChange,
  onSendPrompt,
}: PromptBarProps) {
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL)
  const [selectedEffort, setSelectedEffort] = useState<ReasoningEffort>(DEFAULT_EFFORT)
  const [isModelPopoverOpen, setIsModelPopoverOpen] = useState(false)
  const [activePopoverTab, setActivePopoverTab] = useState<ModelPopoverTab>("effort")
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false)

  const [selectedFolder, setSelectedFolder] = useState<FolderItem | null>(null)
  const [recentFolders, setRecentFolders] = useState<FolderItem[]>(loadSavedRecentFolders)
  const [isFolderMenuOpen, setIsFolderMenuOpen] = useState(false)

  const attachMenuRef = useRef<HTMLDivElement>(null)
  const modelSelectorRef = useRef<HTMLDivElement>(null)
  const folderMenuRef = useRef<HTMLDivElement>(null)

  useClickOutside(attachMenuRef, () => setIsAttachMenuOpen(false))
  useClickOutside(modelSelectorRef, () => setIsModelPopoverOpen(false))
  useClickOutside(folderMenuRef, () => setIsFolderMenuOpen(false))

  const selectedEffortIndex = REASONING_EFFORTS.indexOf(selectedEffort)
  const sliderProgressRatio = selectedEffortIndex / (REASONING_EFFORTS.length - 1)

  const selectEffortByPointerX = (clientX: number, trackElement: HTMLDivElement) => {
    const trackRect = trackElement.getBoundingClientRect()
    const usableTrackWidth = Math.max(1, trackRect.width - SLIDER_THUMB_SIZE_PX)
    const relativeX = clientX - trackRect.left - SLIDER_THUMB_RADIUS_PX
    const clampedRatio = Math.min(1, Math.max(0, relativeX / usableTrackWidth))
    const nearestStepIndex = Math.round(clampedRatio * (REASONING_EFFORTS.length - 1))
    const nextEffort = REASONING_EFFORTS[nearestStepIndex]

    if (nextEffort) {
      setSelectedEffort(nextEffort)
    }
  }

  const handleSliderPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    selectEffortByPointerX(event.clientX, event.currentTarget)
  }

  const handleSliderPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.buttons !== 1) return
    selectEffortByPointerX(event.clientX, event.currentTarget)
  }

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      onSendPrompt(selectedModel, selectedEffort)
    }
  }

  const handleAttachMock = (attachmentType: "file" | "folder") => {
    alert(`Attached: ${attachmentType === "file" ? "service.go" : "internal/refund/"}`)
    setIsAttachMenuOpen(false)
  }

  const savePickedFolder = (folder: FolderItem) => {
    setRecentFolders((prev) => {
      const filtered = prev.filter((item) => item.path !== folder.path)
      const updated = [folder, ...filtered].slice(0, MAX_RECENT_FOLDERS)
      try {
        localStorage.setItem(STORAGE_KEYS.RECENT_FOLDERS, JSON.stringify(updated))
      } catch {
        // Ignore storage error
      }
      return updated
    })
    setSelectedFolder(folder)
  }

  const handleOpenFolderDialog = async () => {
    setIsFolderMenuOpen(false)
    let pickedFolder: FolderItem | null = null

    if (window.desktop?.selectFolder) {
      try {
        const result = await window.desktop.selectFolder()
        if (result && typeof result === "object" && result.name) {
          pickedFolder = { name: result.name, path: result.path }
        } else if (typeof result === "string" && result) {
          pickedFolder = { name: result, path: result }
        }
      } catch {
        pickedFolder = null
      }
    }

    if (!pickedFolder && window.showDirectoryPicker) {
      try {
        const directoryHandle = await window.showDirectoryPicker()
        if (directoryHandle?.name) {
          pickedFolder = { name: directoryHandle.name, path: directoryHandle.name }
        }
      } catch {
        // User cancelled directory picker
        return
      }
    }

    if (pickedFolder) {
      savePickedFolder(pickedFolder)
    }
  }

  return (
    <div className={styles.promptFooter}>
      <div className={styles.promptContainer}>
        {/* Main Input Card */}
        <div className={styles.promptCard}>
          <textarea
            className={styles.promptTextarea}
            placeholder="Reply or assign next task. Type @ to attach files"
            rows={2}
            value={promptText}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={handleTextareaKeyDown}
          />

          <div className={styles.promptToolbar}>
            {/* Left: Attach (+) */}
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

            {/* Right: Model & Reasoning Effort Selector + Send */}
            <div className={styles.toolbarActions} ref={modelSelectorRef}>
              <button
                type="button"
                className={`${styles.modelSelectorButton} ${
                  isModelPopoverOpen ? styles.modelSelectorActive : ""
                }`}
                onClick={() => {
                  setIsModelPopoverOpen((prev) => !prev)
                  setActivePopoverTab("effort")
                }}
              >
                <span>{selectedModel}</span>
                <span className={styles.selectedEffortBadge}>{selectedEffort}</span>
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 16 16"
                  fill="none"
                  className={styles.chevronIcon}
                >
                  <path
                    d="M4 6l4 4 4-4"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>

              <button
                type="button"
                className={styles.sendButton}
                onClick={() => onSendPrompt(selectedModel, selectedEffort)}
                aria-label="Send prompt"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M8 13V3M3 8l5-5 5 5"
                    stroke="white"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              {isModelPopoverOpen && (
                <div className={styles.modelPopover}>
                  {activePopoverTab === "effort" ? (
                    <div className={styles.effortPanel}>
                      <div className={styles.effortPanelHeader}>
                        <button
                          type="button"
                          className={styles.modelSwitchButton}
                          onClick={(event) => {
                            event.stopPropagation()
                            setActivePopoverTab("models")
                          }}
                        >
                          <span className={styles.popoverModelName}>{selectedModel}</span>
                          <span className={styles.popoverEffortName}>{selectedEffort}</span>
                          <svg
                            width="11"
                            height="11"
                            viewBox="0 0 16 16"
                            fill="none"
                            className={styles.popoverChevronIcon}
                          >
                            <path
                              d="M6 4l4 4-4 4"
                              stroke="currentColor"
                              strokeWidth="1.7"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </div>

                      <div
                        className={styles.effortSliderTrack}
                        onPointerDown={handleSliderPointerDown}
                        onPointerMove={handleSliderPointerMove}
                      >
                        <div
                          className={styles.effortSliderFill}
                          style={{
                            width: `calc(${SLIDER_THUMB_RADIUS_PX}px + ${sliderProgressRatio} * (100% - ${SLIDER_THUMB_SIZE_PX}px))`,
                          }}
                        />
                        <div className={styles.effortSliderSteps}>
                          {REASONING_EFFORTS.map((effortOption, stepIndex) => (
                            <span
                              key={effortOption}
                              className={`${styles.effortStepDot} ${
                                stepIndex < selectedEffortIndex ? styles.completedStep : ""
                              } ${selectedEffort === effortOption ? styles.activeStep : ""}`}
                              onClick={(event) => {
                                event.stopPropagation()
                                setSelectedEffort(effortOption)
                              }}
                            />
                          ))}
                        </div>
                        <div
                          className={styles.effortSliderThumb}
                          style={{
                            left: `calc(${sliderProgressRatio} * (100% - ${SLIDER_THUMB_SIZE_PX}px))`,
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className={styles.modelListPanel}>
                      <div className={styles.modelListHeader}>
                        <span className={styles.modelListTitle}>Select model</span>
                        <button
                          type="button"
                          className={styles.backToEffortButton}
                          onClick={(event) => {
                            event.stopPropagation()
                            setActivePopoverTab("effort")
                          }}
                        >
                          ← Effort
                        </button>
                      </div>
                      <div className={styles.modelListSubtitle}>Recommended set of models</div>

                      {MODEL_OPTIONS.map((modelOption) => {
                        const isSelected = selectedModel === modelOption.name
                        return (
                          <div
                            key={modelOption.name}
                            className={`${styles.modelOptionItem} ${
                              isSelected ? styles.selected : ""
                            }`}
                            onClick={(event) => {
                              event.stopPropagation()
                              setSelectedModel(modelOption.name)
                              setActivePopoverTab("effort")
                            }}
                          >
                            <div>
                              <div>{modelOption.name}</div>
                              <div className={styles.modelOptionDescription}>
                                {modelOption.description}
                              </div>
                            </div>
                            {isSelected && <span>✓</span>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Bar below Prompt Card: Folder Selector */}
        <div className={styles.promptBottomBar}>
          <div className={styles.folderSelectorContainer} ref={folderMenuRef}>
            {isFolderMenuOpen && (
              <div className={styles.folderPopoverMenu}>
                <button
                  type="button"
                  className={styles.folderMenuItem}
                  onClick={() => {
                    setSelectedFolder(null)
                    setIsFolderMenuOpen(false)
                  }}
                >
                  <span>No folder</span>
                  {selectedFolder === null && (
                    <svg
                      className={styles.folderCheckIcon}
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      fill="none"
                    >
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

                <div className={styles.folderMenuDivider} />

                <div className={styles.folderSectionLabel}>Recent</div>
                {recentFolders.length === 0 ? (
                  <div className={styles.folderEmptyRecent}>No recent folders</div>
                ) : (
                  recentFolders.map((folderItem) => {
                    const isCurrentFolder = selectedFolder?.path === folderItem.path
                    return (
                      <button
                        key={folderItem.path}
                        type="button"
                        className={styles.folderMenuItem}
                        title={folderItem.path}
                        onClick={() => {
                          setSelectedFolder(folderItem)
                          setIsFolderMenuOpen(false)
                        }}
                      >
                        <span className={styles.folderItemName}>{folderItem.name}</span>
                        {isCurrentFolder && (
                          <svg
                            className={styles.folderCheckIcon}
                            width="14"
                            height="14"
                            viewBox="0 0 16 16"
                            fill="none"
                          >
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
                  })
                )}

                <div className={styles.folderMenuDivider} />

                <button
                  type="button"
                  className={styles.folderMenuItem}
                  onClick={handleOpenFolderDialog}
                >
                  <span>Open folder...</span>
                </button>
              </div>
            )}

            <button
              type="button"
              className={`${styles.folderTriggerButton} ${
                isFolderMenuOpen ? styles.folderTriggerActive : ""
              }`}
              title={selectedFolder?.path ?? "No folder selected"}
              onClick={() => setIsFolderMenuOpen((prev) => !prev)}
            >
              <svg
                className={styles.folderTriggerIcon}
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
              >
                <path
                  d="M1.5 4a1 1 0 0 1 1-1h3.2l1.4 1.5H13a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V4Z"
                  stroke="currentColor"
                  strokeWidth="1.35"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{selectedFolder ? selectedFolder.name : "No folder"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}