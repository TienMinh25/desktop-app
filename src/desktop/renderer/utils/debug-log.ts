import { DEBUG_LOG_CONFIG } from "../constants"
import {
  useAuthStore,
  useChatStore,
  useCustomizeStore,
  useProjectStore,
  usePromptSettingsStore,
  useThemeStore,
  useToastStore,
  type DebugLogEntry,
} from "../stores"

export interface StoreSnapshotItem {
  name: string
  summary: string
  data: Record<string, unknown>
}

export function isImportantLog(entry: DebugLogEntry): boolean {
  if (entry.category === "api" || entry.level === "error") return true
  return !DEBUG_LOG_CONFIG.NOISY_IPC_CHANNELS.some((channel) => entry.message.includes(channel))
}

export function stripStoreFunctions(value: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([key, val]) => key !== "actions" && typeof val !== "function",
    ),
  )
}

export function buildLocalStoreSnapshots(): StoreSnapshotItem[] {
  const auth = useAuthStore.getState()
  const theme = useThemeStore.getState()
  const toast = useToastStore.getState()
  const project = useProjectStore.getState()
  const chat = useChatStore.getState()
  const promptSettings = usePromptSettingsStore.getState()
  const customize = useCustomizeStore.getState()

  return [
    {
      name: "AuthStore",
      summary: auth.authState?.authenticated
        ? `signed in: ${auth.authState.username ?? ""}`
        : "signed out",
      data: stripStoreFunctions(auth),
    },
    {
      name: "ProjectStore",
      summary: `${project.assignedProjects.length} projects · ${project.sessions.length} sessions`,
      data: stripStoreFunctions(project),
    },
    {
      name: "ChatStore",
      summary: `${Object.keys(chat.turns).length} active turns`,
      data: stripStoreFunctions(chat),
    },
    {
      name: "PromptSettingsStore",
      summary: `${promptSettings.selectedModel} · ${promptSettings.selectedEffort} · ${promptSettings.approvalMode}`,
      data: stripStoreFunctions(promptSettings),
    },
    {
      name: "CustomizeStore",
      summary: `${customize.isOpen ? `open (${customize.initialTab})` : "closed"} · LSP=${String(customize.hasEnabledLspServer)}`,
      data: stripStoreFunctions(customize),
    },
    {
      name: "ThemeStore",
      summary: theme.theme,
      data: stripStoreFunctions(theme),
    },
    {
      name: "ToastStore",
      summary: toast.activeToast ? `${toast.activeToast.type}: ${toast.activeToast.message}` : "idle",
      data: stripStoreFunctions(toast),
    },
  ]
}

export function formatLogEntryText(item: DebugLogEntry): string {
  const metaStr =
    item.meta !== undefined
      ? `\n${typeof item.meta === "string" ? item.meta : JSON.stringify(item.meta, null, 2)}`
      : ""
  return `${item.timestamp} [${item.category.toUpperCase()}] ${item.message}${metaStr}`
}
