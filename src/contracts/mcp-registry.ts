export interface McpListServersParams {
  cursor?: string
  limit?: number
  search?: string
  version?: string
}

export interface McpConnectorItem {
  id: string
  serverName: string
  version: string
  title: string
  description: string
  author: string
  authorUrl?: string
  iconUrl?: string
  category: string
  signInRequired: boolean
  connectorUrl: string
  publishedAt?: string
  updatedAt?: string
  websiteUrl?: string
  repositoryUrl?: string
  tools: string[]
  isCustom?: boolean
}

export interface McpListServersResponse {
  items: McpConnectorItem[]
  nextCursor: string | null
  count: number
}
