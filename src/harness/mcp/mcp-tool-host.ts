import type { HarnessTool, ToolContext } from "../agent/tool-registry"
import { permissionRequest } from "../tools/tool-utils"
import { McpStdioClient } from "./mcp-stdio-client"

interface McpServerConfig { name: string; command: string; args?: string[]; env?: Record<string, string>; cwd?: string }

export class McpToolHost {
  private readonly clients: McpStdioClient[] = []
  private initialized?: Promise<HarnessTool[]>

  constructor(private readonly serializedConfig: string | undefined) {}

  tools(workspacePath: string): Promise<HarnessTool[]> {
    if (!this.initialized) this.initialized = this.connectConfiguredServers(workspacePath)
    return this.initialized
  }

  close() { for (const client of this.clients) client.close() }

  private async connectConfiguredServers(workspacePath: string): Promise<HarnessTool[]> {
    if (!this.serializedConfig) return []
    const configs = JSON.parse(this.serializedConfig) as unknown
    if (!Array.isArray(configs)) throw new Error("MCP_SERVERS must be a JSON array")
    const output: HarnessTool[] = []
    const serverNames = new Set<string>()
    try { for (const raw of configs) {
      const config = validateConfig(raw)
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
            function: {
              name: functionName,
              description: `[MCP ${config.name}] ${toolInfo.description ?? toolInfo.name}`,
              parameters: boundedSchema(toolInfo.inputSchema, config.name, toolInfo.name),
            },
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
}

function boundedSchema(schema: Record<string, unknown>, serverName: string, toolName: string) {
  if (Buffer.byteLength(JSON.stringify(schema), "utf8") > 50_000) throw new Error(`MCP tool schema too large: ${serverName}:${toolName}`)
  if (schema.type !== "object") throw new Error(`MCP tool schema must have object type: ${serverName}:${toolName}`)
  return schema
}

function validateConfig(value: unknown): McpServerConfig {
  if (!isRecord(value)) throw new Error("Each MCP server config must be an object")
  const name = value.name
  const command = value.command
  if (typeof name !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(name)) throw new Error("MCP server name must use 1-32 letters, numbers, _ or -")
  if (typeof command !== "string" || !command) throw new Error(`MCP server ${name} requires a command`)
  const args = value.args
  if (args !== undefined && !isStringArray(args)) throw new Error(`MCP server ${name} args must be strings`)
  const env = value.env
  if (env !== undefined && !isStringRecord(env)) throw new Error(`MCP server ${name} env must map strings to strings`)
  const cwd = value.cwd
  if (cwd !== undefined && typeof cwd !== "string") throw new Error(`MCP server ${name} cwd must be a string`)
  return {
    name,
    command,
    ...(args === undefined ? {} : { args }),
    ...(env === undefined ? {} : { env }),
    ...(cwd === undefined ? {} : { cwd }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item): item is string => typeof item === "string")
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item): item is string => typeof item === "string")
}
