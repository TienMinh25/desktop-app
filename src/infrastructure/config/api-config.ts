export const API_CONFIG = {
  MCP_REGISTRY_BASE_URL:
    process.env.MCP_REGISTRY_BASE_URL?.trim() || "https://registry.modelcontextprotocol.io",
  MCP_REGISTRY_API_VERSION:
    process.env.MCP_REGISTRY_API_VERSION?.trim() || "v0.1",
  RESPONSES_API_URL: resolveResponsesUrl(process.env.RESPONSES_API_URL, process.env.CHAT_COMPLETIONS_URL),
  CHAT_ACCESS_TOKEN: process.env.CHAT_ACCESS_TOKEN?.trim() || "YOUR_JWT_ACCESS_TOKEN",
  UPDATE_FEED_URL:
    process.env.UPDATE_FEED_URL?.trim() || "https://updates.ccodex.com/releases",
} as const

function resolveResponsesUrl(responsesUrl: string | undefined, legacyChatUrl: string | undefined): string {
  const configuredResponsesUrl = responsesUrl?.trim()
  if (configuredResponsesUrl) return configuredResponsesUrl
  const legacyUrl = legacyChatUrl?.trim()
  if (!legacyUrl) return ""
  return legacyUrl.replace(/\/chat\/completions\/?$/, "/responses")
}
