import { HARNESS_EVENT_TYPES, type HarnessEvent } from "../contracts/events"
import type { SubmitPromptCommand } from "../contracts/commands"
import type { ChatModel } from "../domain/chat/types"
import { AgentLoop } from "./agent/agent-loop"
import { homedir } from "node:os"
import { PermissionManager } from "./permissions/permission-manager"
import { ToolRegistry } from "./agent/tool-registry"
import type { ConversationStore } from "./session/conversation-store"
import type { ExecutionEnvironment } from "./execution/execution-environment"
import type { UserQuestion } from "./interaction/question-manager"
import { isAbsolute, resolve } from "node:path"

export interface HarnessRuntimeOptions {
  conversations: ConversationStore
  tools: ToolRegistry
  permissions: PermissionManager
  createChatModel(modelName: string): ChatModel
  createExecutionEnvironment(workspacePath: string): ExecutionEnvironment
  ensureMcpToolsRegistered?(workspacePath: string): Promise<void>
  askUser?(question: UserQuestion): Promise<string>
  emit(event: HarnessEvent): void
  configurationError?: string | null
}

/** Headless harness orchestration. This module knows nothing about Electron or renderer IPC. */
export class HarnessRuntime {
  private readonly sessionQueues = new Map<string, Promise<void>>()

  constructor(private readonly options: HarnessRuntimeOptions) {}

  submit(command: SubmitPromptCommand): void {
    const previous = this.sessionQueues.get(command.sessionId) ?? Promise.resolve()
    const current = previous.then(() => this.runPrompt(command), () => this.runPrompt(command)).catch((error) => {
      this.options.emit({ type: HARNESS_EVENT_TYPES.CHAT_FAILED, requestId: command.requestId, sessionId: command.sessionId, message: error instanceof Error ? error.message : "Unknown harness error" })
    })
    this.sessionQueues.set(command.sessionId, current)
    void current.finally(() => { if (this.sessionQueues.get(command.sessionId) === current) this.sessionQueues.delete(command.sessionId) })
  }

  private async runPrompt(command: SubmitPromptCommand) {
    const emit = this.options.emit
    const fail = (message: string) => emit({ type: HARNESS_EVENT_TYPES.CHAT_FAILED, requestId: command.requestId, sessionId: command.sessionId, message })
    if (this.options.configurationError) return fail(this.options.configurationError)
    const workspacePath = resolveWorkspacePath(command.workspacePath, homedir())
    let environment: ExecutionEnvironment | undefined
    try {
      environment = this.options.createExecutionEnvironment(workspacePath)
      await this.options.ensureMcpToolsRegistered?.(workspacePath)
      const messages = await this.options.conversations.getMessages(command.sessionId)
      messages.push({ role: "user", content: command.prompt })
      const loop = new AgentLoop(this.options.createChatModel(command.model), this.options.tools)
      const result = await loop.run({
        modelName: command.model,
        messages,
        context: {
          workspacePath,
          requestId: command.requestId,
          sessionId: command.sessionId,
          environment,
          requirePermission: (request) => this.options.permissions.request({ ...request, requestId: command.requestId, sessionId: command.sessionId }, command.approvalMode),
          askUser: (question) => this.options.askUser
            ? this.options.askUser({ ...question, requestId: command.requestId, sessionId: command.sessionId })
            : Promise.reject(new Error("User questions are unavailable")),
          notifyTodoUpdate(todos) {
            emit({ type: HARNESS_EVENT_TYPES.TODO_UPDATED, requestId: command.requestId, sessionId: command.sessionId, todos })
          },
        },
        onTextDelta(text) { emit({ type: HARNESS_EVENT_TYPES.ASSISTANT_DELTA, requestId: command.requestId, sessionId: command.sessionId, text }) },
        onToolStarted(toolCallId, toolName) { emit({ type: HARNESS_EVENT_TYPES.TOOL_STARTED, requestId: command.requestId, sessionId: command.sessionId, toolCallId, toolName }) },
        onToolCompleted(toolCallId, toolName) { emit({ type: HARNESS_EVENT_TYPES.TOOL_COMPLETED, requestId: command.requestId, sessionId: command.sessionId, toolCallId, toolName }) },
        onToolFailed(toolCallId, toolName, message) { emit({ type: HARNESS_EVENT_TYPES.TOOL_FAILED, requestId: command.requestId, sessionId: command.sessionId, toolCallId, toolName, message }) },
      })
      await this.options.conversations.saveMessages(command.sessionId, result.messages)
      emit({ type: HARNESS_EVENT_TYPES.CHAT_COMPLETED, requestId: command.requestId, sessionId: command.sessionId })
    } catch (error) {
      fail(error instanceof Error ? error.message : "Unknown chat error")
    } finally {
      environment?.close()
    }
  }
}

export function resolveWorkspacePath(workspacePath: string | undefined, homeDirectory: string): string {
  const requestedPath = workspacePath?.trim()
  if (!requestedPath) return resolve(homeDirectory)
  return isAbsolute(requestedPath) ? resolve(requestedPath) : resolve(homeDirectory, requestedPath)
}
