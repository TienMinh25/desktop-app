import type { HarnessTool, ToolContext } from "../agent/tool-registry"
import { McpServerConfigListSchema, type McpServerConfig } from "../../contracts/mcp-server-config"
import { permissionRequest } from "../tools/tool-utils"
import { McpStdioClient } from "./mcp-stdio-client"

export class McpToolHost {
  private readonly clients: McpStdioClient[] = []
  private initialized?: Promise<HarnessTool[]>

  constructor(private readonly configuredServers: readonly McpServerConfig[] | string | undefined) {}

  tools(workspacePath: string): Promise<HarnessTool[]> {
    if (!this.initialized) this.initialized = this.connectConfiguredServers(workspacePath)
    return this.initialized
  }

  close() { for (const client of this.clients) client.close() }

  private async connectConfiguredServers(workspacePath: string): Promise<HarnessTool[]> {
    const configs = this.parseConfiguredServers()
    if (configs.length === 0) return []
    const output: HarnessTool[] = []
    const serverNames = new Set<string>()
    try { for (const config of configs) {
      if (serverNames.has(config.name)) throw new Error(`Duplicate MCP server name: ${config.name}`)
      serverNames.add(config.name)
      const env: NodeJS.ProcessEnv = {}
      for (const key of ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TEMP", "TMP", "LANG", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE"]) {
        if (process.env[key] !== undefined) env[key] = process.env[key]
      }
      Object.assign(env, config.env)
      const client = new McpStdioClient(config.command, config.args ?? [], config.cwd ?? workspacePath, env)
      this.clients.push(client)
      let discovered
      try { discovered = await client.connect() }
      catch (error) {
        client.close()
        throw new Error(`Could not connect MCP server ${config.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
      for (const toolInfo of discovered) {
        const functionName = `mcp_${config.name}_${toolInfo.name}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64)
        output.push({
          definition: {
            type: "function",
            name: functionName,
            description: `[MCP ${config.name}] ${toolInfo.description ?? toolInfo.name}`,
            parameters: boundedSchema(toolInfo.inputSchema, config.name, toolInfo.name),
            strict: false,
          },
          async prepare(_args: unknown) {
            return { permissionRequests: [permissionRequest("mcp", "call an MCP tool", `${config.name}:${toolInfo.name}`, true, false, "This invokes a configured external MCP server.")] }
          },
          async execute(args: unknown, _context: ToolContext) {
            if (!isRecord(args)) throw new Error("MCP tool arguments must be an object")
            return client.callTool(toolInfo.name, args)
          },
        })
      }
    } } catch (error) {
      this.close()
      throw error
    }
    return output
  }

  private parseConfiguredServers(): readonly McpServerConfig[] {
    if (!this.configuredServers) return []
    if (typeof this.configuredServers !== "string") return this.configuredServers
    let raw: unknown
    try {
      raw = JSON.parse(this.configuredServers)
    } catch {
      throw new Error("MCP_SERVERS must be a valid JSON array")
    }
    const parsed = McpServerConfigListSchema.safeParse(raw)
    if (!parsed.success) throw new Error(`Invalid MCP_SERVERS: ${parsed.error.issues[0]?.message ?? "invalid server entry"}`)
    return parsed.data
  }
}

function boundedSchema(schema: Record<string, unknown>, serverName: string, toolName: string) {
  if (Buffer.byteLength(JSON.stringify(schema), "utf8") > 50_000) throw new Error(`MCP tool schema too large: ${serverName}:${toolName}`)
  if (schema.type !== "object") throw new Error(`MCP tool schema must have object type: ${serverName}:${toolName}`)
  return schema
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
