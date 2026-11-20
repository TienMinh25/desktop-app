import type { ApprovalMode } from "../../../../contracts/permissions"
import {
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
  STORAGE_KEYS,
  type ReasoningEffort,
} from "../../constants"
import { createPersistedAppStore } from "../create-store"

const PROMPT_SETTINGS_ACTIONS = {
  SET_MODEL: "promptSettings/setModel",
  SET_EFFORT: "promptSettings/setEffort",
  SET_APPROVAL_MODE: "promptSettings/setApprovalMode",
  SELECT_FOLDER: "promptSettings/selectFolder",
  CLEAR_FOLDER: "promptSettings/clearFolder",
} as const

export interface FolderItem {
  name: string
  path: string
}

const MAX_RECENT_FOLDERS = 5

interface PromptSettingsState {
  selectedModel: string
  selectedEffort: ReasoningEffort
  approvalMode: ApprovalMode
  selectedFolder: FolderItem | null
  recentFolders: FolderItem[]

  setSelectedModel: (model: string) => void
  setSelectedEffort: (effort: ReasoningEffort) => void
  setApprovalMode: (mode: ApprovalMode) => void
  selectFolder: (folder: FolderItem) => void
  clearSelectedFolder: () => void
}

function loadLegacyRecentFolders(): FolderItem[] {
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

type PersistedPromptSettings = Pick<
  PromptSettingsState,
  "selectedModel" | "selectedEffort" | "approvalMode" | "recentFolders"
>

export const usePromptSettingsStore = createPersistedAppStore<
  PromptSettingsState,
  PersistedPromptSettings
>(
  "PromptSettingsStore",
  (set) => ({
    selectedModel: DEFAULT_MODEL,
    selectedEffort: DEFAULT_EFFORT,
    approvalMode: "manual",
    selectedFolder: null,
    recentFolders: loadLegacyRecentFolders(),

    setSelectedModel: (selectedModel) =>
      set({ selectedModel }, false, PROMPT_SETTINGS_ACTIONS.SET_MODEL),
    setSelectedEffort: (selectedEffort) =>
      set({ selectedEffort }, false, PROMPT_SETTINGS_ACTIONS.SET_EFFORT),
    setApprovalMode: (approvalMode) =>
      set({ approvalMode }, false, PROMPT_SETTINGS_ACTIONS.SET_APPROVAL_MODE),

    selectFolder: (folder) =>
      set(
        (state) => {
          const filtered = state.recentFolders.filter((item) => item.path !== folder.path)
          return {
            selectedFolder: folder,
            recentFolders: [folder, ...filtered].slice(0, MAX_RECENT_FOLDERS),
          }
        },
        false,
        PROMPT_SETTINGS_ACTIONS.SELECT_FOLDER,
      ),

    clearSelectedFolder: () =>
      set({ selectedFolder: null }, false, PROMPT_SETTINGS_ACTIONS.CLEAR_FOLDER),
  }),
  {
    name: "ccodex-prompt-settings",
    partialize: (state) => ({
      selectedModel: state.selectedModel,
      selectedEffort: state.selectedEffort,
      approvalMode: state.approvalMode,
      recentFolders: state.recentFolders,
    }),
  },
)
