import { Client } from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"

interface McpToolInfo { name: string; description?: string; inputSchema: Record<string, unknown> }

/** MCP SDK-backed stdio client; configured tools retain the harness permission boundary. */
export class McpStdioClient {
  private readonly client = new Client(
    { name: "desktop-coding-harness", version: "0.1.0" },
    { versionNegotiation: { mode: "legacy" } },
  )
  private readonly transport: StdioClientTransport
  private connected = false

  constructor(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, private readonly connectTimeoutMs = 10_000) {
    const safeEnv = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    this.transport = new StdioClientTransport({ command, args, cwd, env: safeEnv, stderr: "ignore", maxBufferSize: 1_000_000 })
  }

  async connect(): Promise<McpToolInfo[]> {
    await this.client.connect(this.transport, { timeout: this.connectTimeoutMs })
    this.connected = true
    const result = await this.client.listTools({}, { timeout: 30_000 })
    return result.tools.map((tool) => ({
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }))
  }

  async callTool(name: string, argumentsValue: Record<string, unknown>): Promise<string> {
    if (!this.connected) throw new Error("MCP process is not running")
    const result = await this.client.callTool({ name, arguments: argumentsValue }, { timeout: 30_000 })
    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.type === "text" ? item.text : "")
      .join("\n")
      .slice(0, 30_000)
    if (result.isError) throw new Error(text || `MCP tool ${name} failed`)
    return text || JSON.stringify(result).slice(0, 30_000)
  }

  close() {
    this.connected = false
    void this.client.close()
  }
}
