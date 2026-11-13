import type {
  McpConnectorItem,
  McpListServersParams,
  McpListServersResponse,
} from "../../contracts/mcp-registry"
import { API_CONFIG } from "../../infrastructure/config/api-config"
import { HttpClient } from "../../infrastructure/http/http-client"
import { normalizeMcpServerEntry, parseMcpListServersPayload } from "./mcp-registry-mapper"
import type { McpRegistryClientConfig, McpRegistryListRawPayload } from "./types"

export class McpRegistryClient {
  private readonly baseUrl: string
  private readonly apiVersion: string

  constructor(
    config: McpRegistryClientConfig = {},
    private readonly httpClient: HttpClient = new HttpClient(),
  ) {
    this.baseUrl = (config.baseUrl ?? API_CONFIG.MCP_REGISTRY_BASE_URL).replace(/\/+$/, "")
    this.apiVersion = config.apiVersion ?? API_CONFIG.MCP_REGISTRY_API_VERSION
  }

  private buildListServersUrl(params: McpListServersParams): string {
    const url = new URL(`/${this.apiVersion}/servers`, this.baseUrl)
    url.searchParams.set("limit", String(params.limit ?? 20))
    url.searchParams.set("version", params.version ?? "latest")
    if (params.cursor) {
      url.searchParams.set("cursor", params.cursor)
    }
    if (params.search && params.search.trim()) {
      url.searchParams.set("search", params.search.trim())
    }
    return url.toString()
  }

  private buildServerVersionUrl(serverName: string, version: string): string {
    const encodedName = encodeURIComponent(serverName)
    const encodedVersion = encodeURIComponent(version || "latest")
    return `${this.baseUrl}/${this.apiVersion}/servers/${encodedName}/versions/${encodedVersion}`
  }

  async listServers(params: McpListServersParams = {}): Promise<McpListServersResponse> {
    const requestUrl = this.buildListServersUrl(params)
    const payload = await this.httpClient.getJson<McpRegistryListRawPayload>(requestUrl)
    return parseMcpListServersPayload(payload, this.baseUrl, this.apiVersion)
  }

  async getServerVersion(serverName: string, version = "latest"): Promise<McpConnectorItem> {
    const requestUrl = this.buildServerVersionUrl(serverName, version)
    const payload = await this.httpClient.getJson<unknown>(requestUrl)
    const normalized = normalizeMcpServerEntry(payload, this.baseUrl, this.apiVersion)
    if (!normalized) {
      throw new Error(`Invalid MCP server detail response for ${serverName}@${version}`)
    }
    return normalized
  }
}
