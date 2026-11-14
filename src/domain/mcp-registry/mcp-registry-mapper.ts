import type { McpConnectorItem, McpListServersResponse } from "../../contracts/mcp-registry"
import type {
  McpRegistryListRawPayload,
  McpRegistryOfficialMeta,
  McpRegistryServerEntry,
  McpRegistryServerJSON,
} from "./types"

function formatServerTitle(rawName: string, rawTitle?: string): string {
  if (rawTitle && rawTitle.trim().length > 0) {
    return rawTitle.trim()
  }
  const slug = rawName.includes("/") ? (rawName.split("/").pop() ?? rawName) : rawName
  const cleaned = slug
    .replace(/^mcp-server-/i, "")
    .replace(/^server-/i, "")
    .replace(/-mcp-server$/i, "")
    .replace(/-mcp$/i, "")
    .replace(/[-_]+/g, " ")
    .trim()
  if (!cleaned) return rawName
  return cleaned
    .split(/\s+/)
    .map((word) =>
      word.length <= 3 && word.toUpperCase() === word
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ")
}

function extractAuthor(rawName: string, repoUrl?: string): string {
  if (rawName.includes("/")) {
    const namespace = rawName.split("/")[0] ?? ""
    const parts = namespace.split(".").filter(Boolean)
    if (
      parts.length >= 3 &&
      (parts[0] === "io" || parts[0] === "com" || parts[0] === "org") &&
      parts[1] === "github"
    ) {
      return parts.slice(2).join(".")
    }
    if (parts.length >= 2) {
      const candidate = parts[parts.length - 1] ?? namespace
      return candidate.charAt(0).toUpperCase() + candidate.slice(1)
    }
    if (namespace) return namespace
  }
  if (repoUrl) {
    try {
      const url = new URL(repoUrl)
      const segments = url.pathname.split("/").filter(Boolean)
      if (segments[0]) return segments[0]
    } catch {
      // Ignore invalid repo URL
    }
  }
  return "MCP Community"
}

function inferCategory(server: McpRegistryServerJSON): string {
  const text = `${server.name} ${server.title ?? ""} ${server.description ?? ""}`.toLowerCase()
  if (/(drive|file|doc|sheet|pdf|notion|box|dropbox|storage|folder)/.test(text)) {
    return "Files & documents"
  }
  if (/(db|database|sql|postgres|mysql|mongo|redis|supabase|neon|sqlite|prisma)/.test(text)) {
    return "Databases & data"
  }
  if (
    /(git|github|gitlab|code|linear|jira|sentry|docker|kubernetes|aws|cloudflare|vercel|netlify)/.test(
      text,
    )
  ) {
    return "Developer tools"
  }
  if (/(slack|mail|gmail|discord|telegram|calendar|chat|message|teams)/.test(text)) {
    return "Communication"
  }
  if (/(search|web|browser|playwright|puppeteer|exa|tavily|brave|scrape|crawl)/.test(text)) {
    return "Search & web"
  }
  if (/(design|figma|canva|image|video|audio|media)/.test(text)) {
    return "Design & media"
  }
  if (server.remotes && server.remotes.length > 0) {
    return "Remote connector"
  }
  return "Productivity & tools"
}

function inferTools(server: McpRegistryServerJSON): string[] {
  const explicit: string[] = []
  if (Array.isArray(server.tools)) {
    for (const t of server.tools) {
      if (typeof t === "string" && t.trim()) explicit.push(t.trim())
      else if (t && typeof t === "object" && typeof t.name === "string" && t.name.trim())
        explicit.push(t.name.trim())
    }
  }
  if (explicit.length > 0) return explicit.slice(0, 12)

  const slug =
    (server.name.split("/").pop() ?? server.name)
      .replace(/^mcp-server-/i, "")
      .replace(/^server-/i, "")
      .replace(/-mcp-server$/i, "")
      .replace(/-mcp$/i, "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase() || "resource"

  const text = `${server.name} ${server.title ?? ""} ${server.description ?? ""}`.toLowerCase()
  const tools = new Set<string>()

  if (/(search|query|find|lookup|exa|brave|tavily)/.test(text)) {
    tools.add(`search_${slug}`)
    tools.add(`query_${slug}`)
  }
  if (/(read|get|fetch|list|inspect|view)/.test(text)) {
    tools.add(`get_${slug}`)
    tools.add(`list_${slug}_items`)
    tools.add(`read_${slug}_content`)
  }
  if (/(create|write|add|insert|upload|post|send)/.test(text)) {
    tools.add(`create_${slug}`)
    tools.add(`update_${slug}`)
  }
  if (/(file|drive|document|folder|storage)/.test(text)) {
    tools.add("search_files")
    tools.add("read_file_content")
    tools.add("list_recent_files")
    tools.add("get_file_metadata")
    tools.add("create_file")
    tools.add("update_file")
  }
  if (/(db|database|sql|query|table|schema)/.test(text)) {
    tools.add("execute_query")
    tools.add("list_tables")
    tools.add("describe_table")
    tools.add("inspect_schema")
  }
  if (/(git|repo|issue|pull|commit|branch)/.test(text)) {
    tools.add("list_repositories")
    tools.add("search_code")
    tools.add("get_issue")
    tools.add("create_pull_request")
  }

  if (tools.size < 4) {
    tools.add(`list_${slug}`)
    tools.add(`get_${slug}_details`)
    tools.add(`search_${slug}`)
    tools.add(`create_${slug}`)
    tools.add(`update_${slug}`)
    tools.add(`delete_${slug}`)
  }

  return Array.from(tools).slice(0, 10)
}

export function normalizeMcpServerEntry(
  raw: unknown,
  baseUrl: string,
  apiVersion = "v0.1",
): McpConnectorItem | null {
  if (!raw || typeof raw !== "object") return null
  const record = raw as Record<string, unknown>

  const serverObj: McpRegistryServerJSON =
    record.server && typeof record.server === "object"
      ? (record.server as McpRegistryServerJSON)
      : (record as unknown as McpRegistryServerJSON)

  if (!serverObj || typeof serverObj.name !== "string" || !serverObj.name.trim()) {
    return null
  }

  const metaContainer =
    record._meta && typeof record._meta === "object"
      ? (record._meta as McpRegistryServerEntry["_meta"])
      : undefined
  const officialMeta: McpRegistryOfficialMeta | undefined =
    metaContainer?.["io.modelcontextprotocol.registry/official"]

  const serverName = serverObj.name.trim()
  const version = (serverObj.version && String(serverObj.version).trim()) || "latest"
  const title = formatServerTitle(serverName, serverObj.title)
  const rawDescription =
    (serverObj.description && String(serverObj.description).trim()) ||
    `Connect ${title} to your workspace via Model Context Protocol.`
  const description = rawDescription
    .replace(/\bClaude\b/gi, "C-Codex")
    .replace(/\bAnthropic\b/gi, "C-Codex")
  const repositoryUrl = serverObj.repository?.url
  const websiteUrl = serverObj.websiteUrl || repositoryUrl
  const rawAuthor = extractAuthor(serverName, repositoryUrl)
  const author = rawAuthor.replace(/\bAnthropic\b/gi, "C-Codex").replace(/\bClaude\b/gi, "C-Codex")
  const iconUrl = serverObj.icons?.find(
    (icon) => icon && typeof icon.src === "string" && icon.src.startsWith("http"),
  )?.src

  const remoteUrl = serverObj.remotes?.find((r) => r && typeof r.url === "string" && r.url.trim())?.url
  const firstPkg = serverObj.packages?.[0]
  const connectorUrl =
    remoteUrl ||
    (firstPkg?.identifier
      ? `${firstPkg.registryType ?? "package"}://${firstPkg.identifier}${firstPkg.version ? `@${firstPkg.version}` : ""}`
      : repositoryUrl ||
        `${baseUrl}/${apiVersion}/servers/${encodeURIComponent(serverName)}/versions/${encodeURIComponent(version)}`)

  const hasRequiredEnv = Boolean(
    serverObj.packages?.some((pkg) =>
      pkg.environmentVariables?.some((envVar) => envVar.isRequired || envVar.isSecret),
    ),
  )
  const hasRequiredHeaders = Boolean(
    serverObj.remotes?.some((rem) => rem.headers?.some((h) => h.isRequired || h.isSecret)),
  )
  const signInRequired = hasRequiredEnv || hasRequiredHeaders || Boolean(remoteUrl)

  return {
    id: `${serverName}@${version}`,
    serverName,
    version,
    title,
    description,
    author,
    authorUrl: websiteUrl,
    iconUrl,
    category: inferCategory(serverObj),
    signInRequired,
    connectorUrl,
    publishedAt: officialMeta?.publishedAt,
    updatedAt: officialMeta?.updatedAt,
    websiteUrl,
    repositoryUrl,
    tools: inferTools(serverObj),
  }
}

export function parseMcpListServersPayload(
  payload: McpRegistryListRawPayload,
  baseUrl: string,
  apiVersion = "v0.1",
): McpListServersResponse {
  const rawServers = Array.isArray(payload.servers) ? payload.servers : []
  const seenNames = new Set<string>()
  const items: McpConnectorItem[] = []

  for (const raw of rawServers) {
    const item = normalizeMcpServerEntry(raw, baseUrl, apiVersion)
    if (!item) continue
    if (seenNames.has(item.serverName)) continue
    seenNames.add(item.serverName)
    items.push(item)
  }

  const nextCursor = payload.metadata?.nextCursor ?? payload.metadata?.next_cursor ?? null

  return {
    items,
    nextCursor: typeof nextCursor === "string" && nextCursor.length > 0 ? nextCursor : null,
    count: typeof payload.metadata?.count === "number" ? payload.metadata.count : items.length,
  }
}
