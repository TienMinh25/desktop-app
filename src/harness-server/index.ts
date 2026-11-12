import { type HarnessCommand } from "../contracts/commands"
import type { HarnessEvent } from "../contracts/events"
import { HARNESS_COMMAND_TYPES, HARNESS_EVENT_TYPES } from "../contracts/message-types"
import { isHarnessCommand } from "../contracts/guards"
import { ChatClient } from "../domain/chat/chat-client"
import { HarnessRuntime } from "../harness/runtime"
import { PermissionManager } from "../harness/permissions/permission-manager"
import { QuestionManager } from "../harness/interaction/question-manager"
import { parsePermissionRules } from "../harness/permissions/permission-config"
import { ToolRegistry } from "../harness/agent/tool-registry"
import { InMemoryConversationStore } from "../harness/session/in-memory-conversation-store"
import { LocalExecutionEnvironment } from "../harness/execution/local-execution-environment"
import { LspManager } from "../harness/lsp/lsp-manager"
import { McpToolHost } from "../harness/mcp/mcp-tool-host"
import { applyPatchTool } from "../harness/tools/apply-patch-tool"
import { bashTool } from "../harness/tools/bash-tool"
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

const permissionConfig = parsePermissionRules(process.env.HARNESS_PERMISSION_RULES)

const tools = new ToolRegistry()
const lspManager = new LspManager(process.env.LSP_SERVERS)
for (const tool of [readTool, writeTool, editTool, globTool, grepTool, bashTool, applyPatchTool, createLspTool(lspManager), webfetchTool, todoWriteTool, skillTool, questionTool]) tools.register(tool)
const permissions = new PermissionManager((event) => parentPort.postMessage(event), permissionConfig.rules)
const questions = new QuestionManager((event) => parentPort.postMessage(event))
const mcpHost = new McpToolHost(process.env.MCP_SERVERS)
let mcpRegistered = false

const runtime = new HarnessRuntime({
  conversations: new InMemoryConversationStore(),
  tools,
  permissions,
  askUser(question) { return questions.ask(question) },
  // Creates the ChatModel adapter for the selected model using the configured company endpoint.
  createChatModel(modelName) {
    const endpoint = process.env.CHAT_COMPLETIONS_URL
    if (!endpoint) throw new Error("CHAT_COMPLETIONS_URL is not configured")
    return new ChatClient({ endpoint, model: modelName, accessToken: process.env.CHAT_ACCESS_TOKEN ?? "YOUR_JWT_ACCESS_TOKEN" })
  },
  createExecutionEnvironment(workspacePath) { return new LocalExecutionEnvironment(workspacePath) },
  // Lazily connects configured MCP servers and registers their tools before the model sees tool definitions.
  async ensureMcpToolsRegistered(workspacePath) {
    if (mcpRegistered) return
    for (const tool of await mcpHost.tools(workspacePath)) tools.register(tool)
    mcpRegistered = true
  },
  emit(event: HarnessEvent) { parentPort.postMessage(event) },
  configurationError: permissionConfig.error,
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
    default:
      return assertNever(command)
  }
})

function assertNever(value: never): never {
  throw new Error(`Unhandled harness command: ${JSON.stringify(value)}`)
}

process.once("exit", () => { questions.close(); mcpHost.close(); lspManager.close() })
