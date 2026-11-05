export const STORAGE_KEYS = {
  THEME: "ccodex-theme",
  RECENT_FOLDERS: "ccodex-recent-folders",
} as const

export const APP_CONFIG = {
  APP_TITLE: "C-CodeX Desktop",
  UPDATE_VERSION: "1.2.0",
  UPDATE_SIZE: "84 MB",
  TERMS_VERSION: "v1.0.0",
  PRIVACY_VERSION: "v1.0.0",
  TOAST_DURATION_MS: 2600,
  IT_HELPDESK_EMAIL: "it-helpdesk@cmcglobal.com.vn",
  SUPPORT_EMAIL: "support@ccodex.com",
} as const

export const MODEL_OPTIONS = [
  { name: "6 Luna", description: "Fast, advanced reasoning" },
  { name: "5.6 Terra", description: "Balanced daily coding" },
  { name: "5.6 Luna", description: "High-accuracy agentic tasks" },
  { name: "GPT-5 (Azure OpenAI)", description: "Enterprise default deployment" },
] as const

export const DEFAULT_MODEL = MODEL_OPTIONS[0].name

export const REASONING_EFFORTS = ["Low", "Medium", "High", "Max"] as const
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]
export const DEFAULT_EFFORT: ReasoningEffort = "Medium"