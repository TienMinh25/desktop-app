import { HARNESS_EVENT_TYPES, type HarnessEvent } from "../contracts/events"
import type { CancelChatCommand, DeleteSessionCommand, SubmitPromptCommand } from "../contracts/commands"
import type { ChatModel } from "../domain/chat/types"
import { AgentLoop } from "./agent/agent-loop"
import { homedir } from "node:os"
import { PermissionManager } from "./permissions/permission-manager"
import { ToolRegistry } from "./agent/tool-registry"
import type { ConversationStore } from "./session/conversation-store"
import { TodoStateStore } from "./session/todo-state-store"
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
  cancelQuestionsForSession?(sessionId: string): void
  emit(event: HarnessEvent): void
  configurationError?: string | null
}

interface SessionPromptQueue {
  active: SubmitPromptCommand | null
  pending: SubmitPromptCommand[]
  deleting: boolean
  draining: boolean
}

/** Headless harness orchestration. This module knows nothing about Electron or renderer IPC. */
export class HarnessRuntime {
  private readonly sessionQueues = new Map<string, SessionPromptQueue>()
  private readonly sessionAgents = new Map<string, AgentLoop>()
  private readonly sessionAbortControllers = new Map<string, AbortController>()
  private readonly todoStates = new TodoStateStore()

  constructor(private readonly options: HarnessRuntimeOptions) {}

  submit(command: SubmitPromptCommand): void {
    const queue = this.getOrCreateQueue(command.sessionId)
    if (queue.deleting) {
      this.emitFailure(command, "This session is being deleted.")
      return
    }

    queue.pending.push(command)
    if (queue.active || queue.draining) {
      this.options.emit({
        type: HARNESS_EVENT_TYPES.CHAT_QUEUED,
        requestId: command.requestId,
        sessionId: command.sessionId,
        prompt: command.prompt,
        queuePosition: queue.pending.length,
      })
      return
    }
    void this.drainSession(command.sessionId, queue)
  }

  cancelSession(command: CancelChatCommand): void {
    this.options.cancelQuestionsForSession?.(command.sessionId)
    this.sessionAbortControllers.get(command.sessionId)?.abort()
  }

  deleteSession(command: DeleteSessionCommand): void {
    this.options.cancelQuestionsForSession?.(command.sessionId)
    this.sessionAbortControllers.get(command.sessionId)?.abort()
    const queue = this.sessionQueues.get(command.sessionId)
    if (!queue) {
      this.cleanupSession(command.sessionId)
      return
    }

    queue.deleting = true
    for (const commandToDrop of queue.pending) {
      this.emitFailure(commandToDrop, "Session deleted before this prompt started.")
    }
    queue.pending = []
    if (!queue.active && !queue.draining) this.cleanupSession(command.sessionId)
  }

  private getOrCreateQueue(sessionId: string): SessionPromptQueue {
    let queue = this.sessionQueues.get(sessionId)
    if (!queue) {
      queue = { active: null, pending: [], deleting: false, draining: false }
      this.sessionQueues.set(sessionId, queue)
    }
    return queue
  }

  private async drainSession(sessionId: string, queue: SessionPromptQueue): Promise<void> {
    if (queue.draining) return
    queue.draining = true
    try {
      while (!queue.deleting && queue.pending.length > 0) {
        const command = queue.pending.shift()
        if (!command) continue
        queue.active = command
        this.options.emit({ type: HARNESS_EVENT_TYPES.CHAT_STARTED, requestId: command.requestId, sessionId, prompt: command.prompt })
        await this.runPrompt(command)
        queue.active = null
      }
    } finally {
      queue.draining = false
      if (queue.deleting) this.cleanupSession(sessionId)
      else if (queue.pending.length === 0 && this.sessionQueues.get(sessionId) === queue) this.sessionQueues.delete(sessionId)
    }
  }

  private cleanupSession(sessionId: string): void {
    this.sessionQueues.delete(sessionId)
    this.sessionAgents.delete(sessionId)
    this.todoStates.clearSession(sessionId)
  }

  private emitFailure(command: SubmitPromptCommand, message: string): void {
    this.options.emit({ type: HARNESS_EVENT_TYPES.CHAT_FAILED, requestId: command.requestId, sessionId: command.sessionId, message })
  }

  private async runPrompt(command: SubmitPromptCommand): Promise<void> {
    const emit = this.options.emit
    const fail = (message: string) => this.emitFailure(command, message)
    if (this.options.configurationError) {
      fail(this.options.configurationError)
      return
    }

    const workspacePath = resolveWorkspacePath(command.workspacePath, homedir())
    const goalScopeId = command.goalId ? `goal:${command.sessionId}:${command.goalId}` : undefined
    const todoScope = goalScopeId
      ? { type: "goal" as const, id: goalScopeId }
      : { type: "request" as const, id: `request:${command.sessionId}:${command.requestId}` }
    let environment: ExecutionEnvironment | undefined
    let model: ChatModel | undefined
    try {
      environment = this.options.createExecutionEnvironment(workspacePath)
      await this.options.ensureMcpToolsRegistered?.(workspacePath)
      const messages = await this.options.conversations.getMessages(command.sessionId)
      messages.push({ role: "user", content: command.prompt })

      let loop = this.sessionAgents.get(command.sessionId)
      if (!loop) {
        loop = new AgentLoop(this.options.tools)
        this.sessionAgents.set(command.sessionId, loop)
      }

      if (todoScope.type === "goal") {
        emit({ type: HARNESS_EVENT_TYPES.TODO_UPDATED, requestId: command.requestId, sessionId: command.sessionId, scopeId: todoScope.id, scopeType: todoScope.type, todos: this.todoStates.get(todoScope.id) })
      }

      model = this.options.createChatModel(command.model)
      const abortController = new AbortController()
      this.sessionAbortControllers.set(command.sessionId, abortController)
      const result = await loop.run(model, {
        modelName: command.model,
        messages,
        signal: abortController.signal,
        context: {
          workspacePath,
          requestId: command.requestId,
          sessionId: command.sessionId,
          environment,
          todoScope,
          updateTodos: (items) => {
            const todos = this.todoStates.upsert(todoScope.id, command.sessionId, items)
            emit({ type: HARNESS_EVENT_TYPES.TODO_UPDATED, requestId: command.requestId, sessionId: command.sessionId, scopeId: todoScope.id, scopeType: todoScope.type, todos })
            return todos
          },
          requirePermission: (request) => this.options.permissions.request({ ...request, requestId: command.requestId, sessionId: command.sessionId }, command.approvalMode),
          askUser: (question) => this.options.askUser
            ? this.options.askUser({ ...question, requestId: command.requestId, sessionId: command.sessionId })
            : Promise.reject(new Error("User questions are unavailable")),
        },
        onTextDelta(text) { emit({ type: HARNESS_EVENT_TYPES.ASSISTANT_DELTA, requestId: command.requestId, sessionId: command.sessionId, text }) },
        onToolStarted(toolCallId, toolName) { emit({ type: HARNESS_EVENT_TYPES.TOOL_STARTED, requestId: command.requestId, sessionId: command.sessionId, toolCallId, toolName }) },
        onToolCompleted(toolCallId, toolName) { emit({ type: HARNESS_EVENT_TYPES.TOOL_COMPLETED, requestId: command.requestId, sessionId: command.sessionId, toolCallId, toolName }) },
        onToolFailed(toolCallId, toolName, message) { emit({ type: HARNESS_EVENT_TYPES.TOOL_FAILED, requestId: command.requestId, sessionId: command.sessionId, toolCallId, toolName, message }) },
      })
      await this.options.conversations.saveMessages(command.sessionId, result.messages)
      emit({ type: HARNESS_EVENT_TYPES.CHAT_COMPLETED, requestId: command.requestId, sessionId: command.sessionId })
    } catch (error) {
      if (this.sessionAbortControllers.get(command.sessionId)?.signal.aborted) {
        emit({ type: HARNESS_EVENT_TYPES.CHAT_COMPLETED, requestId: command.requestId, sessionId: command.sessionId })
      } else {
        fail(error instanceof Error ? error.message : "Unknown chat error")
      }
    } finally {
      this.sessionAbortControllers.delete(command.sessionId)
      try { environment?.close() } catch { /* Keep queue cleanup running if adapter cleanup fails. */ }
      try { await model?.close?.() } catch { /* A transport cleanup error must not block the next prompt. */ }
      if (todoScope.type === "request") this.todoStates.clearRequest(todoScope.id)
    }
  }
}

export function resolveWorkspacePath(workspacePath: string | undefined, homeDirectory: string): string {
  const requestedPath = workspacePath?.trim()
  if (!requestedPath) return resolve(homeDirectory)
  return isAbsolute(requestedPath) ? resolve(requestedPath) : resolve(homeDirectory, requestedPath)
}
