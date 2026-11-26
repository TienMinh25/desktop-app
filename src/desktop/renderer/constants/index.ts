export * from "./rules"

export const STORAGE_KEYS = {
  THEME: "ccodex-theme",
  RECENT_FOLDERS: "ccodex-recent-folders",
  ACCEPTED_TERMS_VERSION: "ccodex-accepted-terms-version",
} as const

export const APP_CONFIG = {
  APP_TITLE: "C-CodeX Desktop",
  UPDATE_VERSION: "1.2.0",
  UPDATE_SIZE: "84 MB",
  TERMS_VERSION: "v1.0.0",
  PRIVACY_VERSION: "v1.0.0",
  TOAST_DURATION_MS: 2600,
  AMS_SUPPORT_URL: "https://c-ticket.cmcglobal.vn",
  TERMS_OF_USE_URL:
    "https://cmcglobalcompany.sharepoint.com/:w:/r/sites/C-CodeXIntelliJIDEPlugin/_layouts/15/Doc.aspx?sourcedoc=%7B0245A84A-B621-4C7C-BD34-309A4F737611%7D&file=%25u0110I%25u1ec0U%20KHO%25u1ea2N%20S%25u1eec%20D%25u1ee4NG%2019.3.2026.docx&action=default&mobileredirect=true",
  PRIVACY_POLICY_URL:
    "https://cmcglobalcompany.sharepoint.com/:w:/r/sites/C-CodeXIntelliJIDEPlugin/_layouts/15/Doc.aspx?sourcedoc=%7B5E221555-3DAD-4E32-9196-693254F5F2F1%7D&file=CH%25u00cdNH%20S%25u00c1CH%20QUY%25u1ec0N%20RI%25u00caNG%20T%25u01af%20C-CODEX%2019.3.2026.docx&action=default&mobileredirect=true",
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