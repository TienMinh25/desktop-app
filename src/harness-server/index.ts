import Database from "better-sqlite3"
import { type HarnessCommand } from "../contracts/commands"
import type { HarnessEvent } from "../contracts/events"
import { HARNESS_COMMAND_TYPES, HARNESS_EVENT_TYPES } from "../contracts/message-types"
import { isHarnessCommand } from "../contracts/guards"
import { ChatClient } from "../domain/chat/chat-client"
import { validate } from "../infrastructure/config/environment"
import { configureConnection, type Db } from "../infrastructure/db/sqlite"
import { BackendHttpClient } from "../infrastructure/http/backend-http-client"
import { AuthTokenProvider } from "./auth-token-provider"
import { HarnessRuntime } from "../harness/runtime"
import { PermissionManager } from "../harness/permissions/permission-manager"
import { QuestionManager } from "../harness/interaction/question-manager"
import { parsePermissionRules } from "../harness/permissions/permission-config"
import { ToolRegistry } from "../harness/agent/tool-registry"
import { InMemoryTurnStore } from "../harness/session/in-memory-turn-store"
import { SqliteTurnStore } from "../harness/session/sqlite-turn-store"
import type { TurnStore } from "../harness/session/turn-store"
import { LocalExecutionEnvironment } from "../harness/execution/local-execution-environment"
import { LspManager } from "../harness/lsp/lsp-manager"
import { McpToolHost } from "../harness/mcp/mcp-tool-host"
import { applyPatchTool } from "../harness/tools/apply-patch-tool"
import { shellTool } from "../harness/tools/shell-tool"
import { editTool } from "../harness/tools/edit-tool"
import { globTool } from "../harness/tools/glob-tool"
import { grepTool } from "../harness/tools/grep-tool"
import { createLspTool } from "../harness/tools/lsp-tool"
import { readTool } from "../harness/tools/read-tool"
import { skillTool } from "../harness/tools/skill-tool"
import { todoWriteTool } from "../harness/tools/todowrite-tool"
import { webfetchTool } from "../harness/tools/webfetch-tool"
import { writeTool } from "../harness/tools/write-tool"
import { questionTool } from "../harness/tools/question-tool"

const parentPort = process.parentPort
if (!parentPort) throw new Error("Harness process must be started by Electron utilityProcess.fork")
const envConfig = validate(process.env)
const authTokenProvider = new AuthTokenProvider(parentPort)

const permissionConfig = parsePermissionRules(process.env.HARNESS_PERMISSION_RULES)
const dbPath = process.env.CCODEX_DB_PATH?.trim()
let db: Db | null = null
let dbError: string | null = null
let turns: TurnStore
if (!dbPath) {
  dbError = "CCODEX_DB_PATH is not configured."
  // Never reached: configurationError fails every prompt before beginTurn
  turns = new InMemoryTurnStore(0)
} else {
  db = new Database(dbPath)
  configureConnection(db, { synchronous: "FULL" })
  const sqliteTurns = new SqliteTurnStore(db)
  sqliteTurns.recoverInterrupted()
  turns = sqliteTurns
}

const tools = new ToolRegistry()
const lspManager = new LspManager()
for (const tool of [readTool, writeTool, editTool, globTool, grepTool, shellTool, applyPatchTool, createLspTool(lspManager), webfetchTool, todoWriteTool, skillTool, questionTool]) tools.register(tool)
const permissions = new PermissionManager((event) => parentPort.postMessage(event), permissionConfig.rules)
const questions = new QuestionManager((event) => parentPort.postMessage(event))
const mcpHost = new McpToolHost(process.env.MCP_SERVERS)
let mcpRegistered = false

const configurationError = [permissionConfig.error, dbError].filter(Boolean).join("\n") || null

const runtime = new HarnessRuntime({
  turns,
  tools,
  permissions,
  // shortcut: provider of the model is unknown until the app reads the model catalog (M-9), turn on per provider then
  supportsMediaInput: () => false,
  askUser(question) { return questions.ask(question) },
  cancelQuestionsForSession(sessionId) { questions.cancelSession(sessionId) },
  // Creates the authenticated backend stream adapter for the selected model.
  createChatModel(modelName) {
    return new ChatClient({ model: modelName }, new BackendHttpClient(envConfig.BACKEND_HOST, authTokenProvider))
  },
  createExecutionEnvironment(workspacePath) { return new LocalExecutionEnvironment(workspacePath) },
  // Lazily connects configured MCP servers and registers their tools before the model sees tool definitions.
  async ensureMcpToolsRegistered(workspacePath) {
    if (mcpRegistered) return
    for (const tool of await mcpHost.tools(workspacePath)) tools.register(tool)
    mcpRegistered = true
  },
  emit(event: HarnessEvent) { parentPort.postMessage(event) },
  configurationError,
})

parentPort.on("message", (messageEvent) => {
  if (!isHarnessCommand(messageEvent.data)) return
  const command = messageEvent.data as HarnessCommand
  switch (command.type) {
    case HARNESS_COMMAND_TYPES.PERMISSION_RESPOND:
      permissions.respond(command.permissionRequestId, command.decision)
      return
    case HARNESS_COMMAND_TYPES.QUESTION_RESPOND:
      questions.respond(command.questionRequestId, command.answer)
      return
    case HARNESS_COMMAND_TYPES.PING:
      parentPort.postMessage({ type: HARNESS_EVENT_TYPES.PONG, requestId: command.requestId } satisfies HarnessEvent)
      return
    case HARNESS_COMMAND_TYPES.CHAT_SUBMIT:
      runtime.submit(command)
      return
    case HARNESS_COMMAND_TYPES.CHAT_CANCEL:
      runtime.cancelSession(command)
      return
    case HARNESS_COMMAND_TYPES.SESSION_DELETE:
      runtime.deleteSession(command)
      return
    case HARNESS_COMMAND_TYPES.LSP_CONFIGURE:
      lspManager.setConfiguration(command.servers)
      return
    default:
      return assertNever(command)
  }
})

parentPort.postMessage({ type: HARNESS_EVENT_TYPES.HARNESS_READY } satisfies HarnessEvent)

function assertNever(value: never): never {
  throw new Error(`Unhandled harness command: ${JSON.stringify(value)}`)
}

let closed = false
function cleanup() {
  if (closed) return
  closed = true
  try {
    questions.close()
    mcpHost.close()
    lspManager.close()
    authTokenProvider.close()
  } finally {
    db?.close()
    db = null
  }
}

process.once("exit", cleanup)
process.once("SIGTERM", () => { cleanup(); process.exit(0) })
process.once("SIGINT", () => { cleanup(); process.exit(0) })
