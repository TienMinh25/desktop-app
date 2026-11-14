export const API_CONFIG = {
  MCP_REGISTRY_BASE_URL:
    process.env.MCP_REGISTRY_BASE_URL?.trim() || "https://registry.modelcontextprotocol.io",
  MCP_REGISTRY_API_VERSION:
    process.env.MCP_REGISTRY_API_VERSION?.trim() || "v0.1",
  CHAT_COMPLETIONS_URL: process.env.CHAT_COMPLETIONS_URL?.trim() || "",
  CHAT_ACCESS_TOKEN: process.env.CHAT_ACCESS_TOKEN?.trim() || "YOUR_JWT_ACCESS_TOKEN",
  UPDATE_FEED_URL:
    process.env.UPDATE_FEED_URL?.trim() || "https://updates.ccodex.com/releases",
} as const
