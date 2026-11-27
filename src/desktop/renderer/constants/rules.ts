export const AUTH_VALIDATION = {
  MAX_USERNAME_LENGTH: 255,
  MAX_PASSWORD_LENGTH: 255,
} as const

export const MCP_SEARCH_CONFIG = {
  MIN_DISCOVER_QUERY_LENGTH: 3,
  DEBOUNCE_MS: 320,
  PAGE_SIZE: 20,
  SCROLL_THRESHOLD_PX: 240,
} as const

export const SIDEBAR_SEARCH_CONFIG = {
  DEBOUNCE_MS: 150,
} as const

export const SIDEBAR_TREE_CONFIG = {
  DEFAULT_VISIBLE_SESSIONS: 10,
} as const

export const SIDEBAR_LAYOUT = {
  DEFAULT_WIDTH: 250,
  MIN_WIDTH: 210,
  MAX_WIDTH: 420,
} as const

export const PROMPT_SLIDER_CONFIG = {
  THUMB_SIZE_PX: 28,
  THUMB_RADIUS_PX: 14,
} as const

export const WORKSPACE_CONFIG = {
  MAX_RECENT_FOLDERS: 5,
} as const

export const DEBUG_LOG_CONFIG = {
  MAX_LOGS_PER_CATEGORY: 300,
  COPY_FEEDBACK_MS: 1200,
  SYNC_CHANNEL: "ccodex-debug-sync",
  NOISY_IPC_CHANNELS: [
    "sessions:list",
    "lsp:list-servers",
    "auth:get-state",
    "projects:list",
    "sidebar:search",
  ],
} as const
