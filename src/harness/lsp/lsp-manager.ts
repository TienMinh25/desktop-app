import { extname } from "node:path"
import { LspClient } from "./lsp-client"
import type { LspOperation } from "./types"

interface ServerConfig { extensions: string[]; command: string; args?: string[]; languageId?: string; cwd?: string; env?: Record<string, string> }
const MAX_RESULT_BYTES = 30_000
export class LspManager {
  private readonly clients = new Map<string, LspClient>()
  constructor(private readonly serializedConfig?: string) {}

  async execute(operation: LspOperation, filePath: string, rootPath: string, text: string, line = 1, character = 1): Promise<string> {
    const config = this.configs().find((item) => item.extensions.includes(extname(filePath).toLowerCase()))
    if (!config) throw new Error(`No language server configured for ${extname(filePath) || "extensionless files"}. Configure LSP_SERVERS.`)
    const key = `${config.command}\0${JSON.stringify(config.args ?? [])}\0${config.cwd ?? rootPath}\0${JSON.stringify(config.env ?? {})}`
    let client = this.clients.get(key)
    if (client && !client.isRunning) {
      this.clients.delete(key)
      client = undefined
    }
    if (!client) {
      const env: NodeJS.ProcessEnv = {}
      for (const name of ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TEMP", "TMP", "LANG", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE"]) {
        if (process.env[name] !== undefined) env[name] = process.env[name]
      }
      Object.assign(env, config.env)
      client = new LspClient(config.command, config.args ?? [], config.cwd ?? rootPath, env)
      this.clients.set(key, client)
    }
    try {
      const uri = await client.open(config.cwd ?? rootPath, filePath, config.languageId ?? languageFromExtension(extname(filePath)), text)
      let result: unknown
      if (operation === "diagnostics") {
        const diagnostics = await client.getDiagnosticsResult(uri)
        result = diagnostics.timedOut ? diagnostics : diagnostics.diagnostics
      } else result = await client.query(operation, uri, line, character)
      if (!client.isRunning) this.clients.delete(key)
      return formatResult(result)
    } catch (error) {
      if (!client.isRunning) this.clients.delete(key)
      throw error
    }
  }

  close() { for (const client of this.clients.values()) client.close(); this.clients.clear() }

  private configs(): ServerConfig[] {
    if (!this.serializedConfig) return []
    let parsed: unknown
    try { parsed = JSON.parse(this.serializedConfig) as unknown }
    catch (error) { throw new Error(`LSP_SERVERS must be valid JSON: ${error instanceof Error ? error.message : String(error)}`) }
    if (!Array.isArray(parsed)) throw new Error("LSP_SERVERS must be a JSON array")
    return parsed.map(parseServerConfig)
  }
}

function formatResult(result: unknown): string {
  const serialized = JSON.stringify(result ?? null, null, 2)
  if (Buffer.byteLength(serialized, "utf8") <= MAX_RESULT_BYTES) return serialized
  const prefix = '{\n  "truncated": true,\n  "preview": '
  const suffix = '\n}'
  let low = 0, high = serialized.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    const candidate = `${prefix}${JSON.stringify(serialized.slice(0, middle))}${suffix}`
    if (Buffer.byteLength(candidate, "utf8") <= MAX_RESULT_BYTES) low = middle
    else high = middle - 1
  }
  return `${prefix}${JSON.stringify(serialized.slice(0, low))}${suffix}`
}

function parseServerConfig(value: unknown): ServerConfig {
  if (!isRecord(value)) throw new Error("Each LSP server config must be an object")
  const extensions = value.extensions
  const command = value.command
  if (!isStringArray(extensions) || extensions.length === 0 || typeof command !== "string" || !command) {
    throw new Error("Each LSP server config requires extensions[] and command")
  }
  const args = value.args
  if (args !== undefined && !isStringArray(args)) throw new Error("LSP server args must be strings")
  const env = value.env
  if (env !== undefined && !isStringRecord(env)) throw new Error("LSP server env must map strings to strings")
  const cwd = value.cwd
  if (cwd !== undefined && typeof cwd !== "string") throw new Error("LSP server cwd must be a string")
  const languageId = value.languageId
  if (languageId !== undefined && typeof languageId !== "string") throw new Error("LSP server languageId must be a string")
  return {
    extensions: extensions.map((extension) => extension.toLowerCase().startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`),
    command,
    ...(args === undefined ? {} : { args }),
    ...(languageId === undefined ? {} : { languageId }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(env === undefined ? {} : { env }),
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

function languageFromExtension(extension: string) {
  const map: Record<string, string> = { ".ts": "typescript", ".tsx": "typescriptreact", ".js": "javascript", ".jsx": "javascriptreact", ".py": "python", ".rs": "rust", ".go": "go" }
  return map[extension.toLowerCase()] ?? "plaintext"
}
