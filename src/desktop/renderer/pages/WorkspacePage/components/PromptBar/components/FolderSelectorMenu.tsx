import { useRef, useState } from "react"
import { useClickOutside } from "../../../../../hooks/useClickOutside"
import type { FolderItem } from "../../../../../stores"
import styles from "../PromptBar.module.scss"

interface FolderSelectorMenuProps {
  selectedFolder: FolderItem | null
  recentFolders: ReadonlyArray<FolderItem>
  onSelectFolder: (folder: FolderItem) => void
  onClearFolder: () => void
}

export function FolderSelectorMenu({
  selectedFolder,
  recentFolders,
  onSelectFolder,
  onClearFolder,
}: FolderSelectorMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useClickOutside(containerRef, () => setIsOpen(false))

  const handleOpenFolderDialog = async () => {
    setIsOpen(false)
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
        return
      }
    }

    if (pickedFolder) {
      onSelectFolder(pickedFolder)
    }
  }

  return (
    <div className={styles.promptBottomBar}>
      <div className={styles.folderSelectorContainer} ref={containerRef}>
        {isOpen && (
          <div className={styles.folderPopoverMenu}>
            <button
              type="button"
              className={styles.folderMenuItem}
              onClick={() => {
                onClearFolder()
                setIsOpen(false)
              }}
            >
              <span>Home directory (default)</span>
              {selectedFolder === null && (
                <svg className={styles.folderCheckIcon} width="14" height="14" viewBox="0 0 16 16" fill="none">
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
                      onSelectFolder(folderItem)
                      setIsOpen(false)
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

            <button type="button" className={styles.folderMenuItem} onClick={handleOpenFolderDialog}>
              <span>Open folder...</span>
            </button>
          </div>
        )}

        <button
          type="button"
          className={`${styles.folderTriggerButton} ${isOpen ? styles.folderTriggerActive : ""}`}
          title={selectedFolder?.path ?? "Using your home directory; choose a folder to change it"}
          onClick={() => setIsOpen((prev) => !prev)}
        >
          <svg className={styles.folderTriggerIcon} width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M1.5 4a1 1 0 0 1 1-1h3.2l1.4 1.5H13a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V4Z"
              stroke="currentColor"
              strokeWidth="1.35"
              strokeLinejoin="round"
            />
          </svg>
          <span>{selectedFolder ? selectedFolder.name : "Home directory"}</span>
        </button>
      </div>
    </div>
  )
}
