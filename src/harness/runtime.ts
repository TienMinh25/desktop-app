import { homedir } from "node:os"
import { isAbsolute, resolve } from "node:path"
import type { CancelChatCommand, DeleteSessionCommand, SubmitPromptCommand } from "../contracts/commands"
import { HARNESS_EVENT_TYPES, type HarnessEvent } from "../contracts/events"
import type { StoredMessagePart } from "../contracts/message-parts"
import type { ChatModel, ResponseInputContent, ResponseInputItem } from "../domain/chat/types"
import { AgentLoop } from "./agent/agent-loop"
import { ToolRegistry, type ToolContext } from "./agent/tool-registry"
import { assembleRequest, loadTurnSnapshot } from "./context/context-assembler"
import { toStoredMedia, type MediaBlob } from "./context/media"
import type { ExecutionEnvironment } from "./execution/execution-environment"
import type { UserQuestion } from "./interaction/question-manager"
import { PermissionManager } from "./permissions/permission-manager"
import { TodoStateStore } from "./session/todo-state-store"
import { TurnGoneError, type TurnHandle, type TurnStore } from "./session/turn-store"

export interface HarnessRuntimeOptions {
  turns: TurnStore
  tools: ToolRegistry
  permissions: PermissionManager
  createChatModel(modelName: string): ChatModel
  createExecutionEnvironment(workspacePath: string): ExecutionEnvironment
  supportsMediaInput?(modelName: string): boolean
  ensureMcpToolsRegistered?(workspacePath: string): Promise<void>
  askUser?(question: UserQuestion): Promise<string>
  cancelQuestionsForSession?(sessionId: string): void
  emit(event: HarnessEvent): void
  configurationError?: string | null
  platform?: string
  now?: () => Date
}

// A cancelled turn is stored as failed with this message until P1 adds an aborted state
export const CANCELLED_MESSAGE = "Cancelled"

interface SessionPromptQueue {
  active: SubmitPromptCommand | null
  pending: SubmitPromptCommand[]
  deleting: boolean
  draining: boolean
}

/** Headless harness orchestration. This module knows nothing about Electron or renderer IPC. */
export class HarnessRuntime {
  private readonly sessionQueues = new Map<string, SessionPromptQueue>()
  private readonly agentLoop: AgentLoop
  private readonly sessionAbortControllers = new Map<string, AbortController>()
  private readonly todoStates = new TodoStateStore()

  constructor(private readonly options: HarnessRuntimeOptions) {
    this.agentLoop = new AgentLoop(options.tools)
  }

  submit(command: SubmitPromptCommand): void {
    const queue = this.getOrCreateQueue(command.sessionId)
    if (queue.deleting) {
      this.emitFailure(command, "This session is being deleted.")
      return
    }
    if (queue.active?.requestId === command.requestId || queue.pending.some((pending) => pending.requestId === command.requestId)) return

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
    this.todoStates.clearSession(sessionId)
  }

  private emitFailure(command: SubmitPromptCommand, message: string): void {
    this.options.emit({ type: HARNESS_EVENT_TYPES.CHAT_FAILED, requestId: command.requestId, sessionId: command.sessionId, prompt: command.prompt, message })
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
    let turn: TurnHandle | undefined
    let finished = false

    try {
      const begun = this.options.turns.beginTurn({
        sessionId: command.sessionId,
        clientRequestId: command.requestId,
        prompt: command.prompt,
        workspacePath,
      })
      if (!begun.created) return
      turn = begun.turn
      // Created right after the turn opens so a cancel during snapshot loading is not lost
      const abortController = new AbortController()
      this.sessionAbortControllers.set(command.sessionId, abortController)
      emit({
        type: HARNESS_EVENT_TYPES.CHAT_STARTED,
        requestId: command.requestId,
        sessionId: command.sessionId,
        prompt: command.prompt,
      })

      environment = this.options.createExecutionEnvironment(workspacePath)
      const activeEnvironment = environment
      await this.options.ensureMcpToolsRegistered?.(workspacePath)

      const toolContext: ToolContext = {
        workspacePath,
        requestId: command.requestId,
        sessionId: command.sessionId,
        environment: activeEnvironment,
        todoScope,
        mediaInput: this.options.supportsMediaInput?.(command.model) ?? false,
        updateTodos: (items) => {
          const todos = this.todoStates.upsert(todoScope.id, command.sessionId, items)
          emit({ type: HARNESS_EVENT_TYPES.TODO_UPDATED, requestId: command.requestId, sessionId: command.sessionId, scopeId: todoScope.id, scopeType: todoScope.type, todos })
          return todos
        },
        requirePermission: (request) => this.options.permissions.request({ ...request, requestId: command.requestId, sessionId: command.sessionId }, command.approvalMode),
        askUser: (question) => this.options.askUser
          ? this.options.askUser({ ...question, requestId: command.requestId, sessionId: command.sessionId })
          : Promise.reject(new Error("User questions are unavailable")),
      }

      const { snapshot, warnings } = await loadTurnSnapshot({
        model: command.model,
        prompt: command.prompt,
        history: begun.history,
        tools: this.options.tools.definitions(toolContext),
        workspacePath,
        environment: activeEnvironment,
        loadBlob: (sha256) => this.options.turns.loadBlob(sha256),
        readFileBase64: (filePath, maxBytes) => readMediaFileBase64(activeEnvironment, filePath, maxBytes),
        mediaInput: toolContext.mediaInput,
        platform: this.options.platform,
        now: this.options.now?.(),
      })

      for (const message of warnings) {
        emit({
          type: HARNESS_EVENT_TYPES.CONTEXT_WARNING,
          requestId: command.requestId,
          sessionId: command.sessionId,
          message,
        })
      }

      if (todoScope.type === "goal") {
        emit({ type: HARNESS_EVENT_TYPES.TODO_UPDATED, requestId: command.requestId, sessionId: command.sessionId, scopeId: todoScope.id, scopeType: todoScope.type, todos: this.todoStates.get(todoScope.id) })
      }

      const activeTurn = turn
      const readCallPaths = new Map<string, string>()
      const persistBatch = async (items: readonly ResponseInputItem[]): Promise<void> => {
        const storedItems: StoredMessagePart[] = []
        const blobs: MediaBlob[] = []
        for (const item of items) {
          if (item.type === "function_call" && item.name === "read" && typeof item.call_id === "string" && typeof item.arguments === "string") {
            const rawPath = extractReadPath(item.arguments)
            if (rawPath) readCallPaths.set(item.call_id, rawPath)
            storedItems.push(item as StoredMessagePart)
            continue
          }
          if (item.type === "function_call_output" && typeof item.call_id === "string") {
            const rawPath = readCallPaths.get(item.call_id)
            readCallPaths.delete(item.call_id)
            if (Array.isArray(item.output)) {
              const path = rawPath ? await resolveReadPath(activeEnvironment, workspacePath, rawPath) : undefined
              const stored = toStoredMedia(item.output as ResponseInputContent[], { path, turnRead: rawPath !== undefined })
              storedItems.push({ ...item, output: stored.parts })
              blobs.push(...stored.blobs)
              continue
            }
          }
          storedItems.push(item as StoredMessagePart)
        }
        this.options.turns.appendSteps(activeTurn, storedItems, blobs)
      }

      model = this.options.createChatModel(command.model)
      const result = await this.agentLoop.run(model, {
        buildRequest: (steps, options) => assembleRequest(snapshot, steps, options),
        persistBatch,
        context: toolContext,
        signal: abortController.signal,
        onTextDelta(text) { emit({ type: HARNESS_EVENT_TYPES.ASSISTANT_DELTA, requestId: command.requestId, sessionId: command.sessionId, text }) },
        onToolStarted(toolCallId, toolName) { emit({ type: HARNESS_EVENT_TYPES.TOOL_STARTED, requestId: command.requestId, sessionId: command.sessionId, toolCallId, toolName }) },
        onToolCompleted(toolCallId, toolName) { emit({ type: HARNESS_EVENT_TYPES.TOOL_COMPLETED, requestId: command.requestId, sessionId: command.sessionId, toolCallId, toolName }) },
        onToolFailed(toolCallId, toolName, message) { emit({ type: HARNESS_EVENT_TYPES.TOOL_FAILED, requestId: command.requestId, sessionId: command.sessionId, toolCallId, toolName, message }) },
      })

      this.options.turns.finishTurn(turn, { items: result.finalBatch, state: "completed" })
      finished = true
      emit({ type: HARNESS_EVENT_TYPES.CHAT_COMPLETED, requestId: command.requestId, sessionId: command.sessionId })
    } catch (error) {
      const cancelled = this.sessionAbortControllers.get(command.sessionId)?.signal.aborted === true
      const message = error instanceof TurnGoneError
        ? "Session was deleted."
        : cancelled ? CANCELLED_MESSAGE : (error instanceof Error ? error.message : "Unknown chat error")
      // A failed completed write rolls back, so the row is still running and must be marked failed or the session stays blocked
      if (turn && !finished && !(error instanceof TurnGoneError)) {
        try {
          this.options.turns.finishTurn(turn, { state: "failed", errorMessage: message })
        } catch (finishError) {
          if (finishError instanceof TurnGoneError) {
            fail("Session was deleted.")
            return
          }
        }
      }
      fail(message)
    } finally {
      this.sessionAbortControllers.delete(command.sessionId)
      try { environment?.close() } catch { /* Keep queue cleanup running if adapter cleanup fails */ }
      try { await model?.close?.() } catch { /* A transport cleanup error must not block the next prompt */ }
      if (todoScope.type === "request") this.todoStates.clearRequest(todoScope.id)
    }
  }
}

async function readMediaFileBase64(environment: ExecutionEnvironment, filePath: string, maxBytes: number): Promise<string> {
  const resolved = await environment.resolvePath(filePath)
  const bytes = await environment.readFileBytes(resolved.path, maxBytes, resolved.insideWorkspace)
  return Buffer.from(bytes).toString("base64")
}

function extractReadPath(argumentsJson: string): string | undefined {
  try {
    const parsed = JSON.parse(argumentsJson) as { path?: unknown }
    return typeof parsed?.path === "string" && parsed.path ? parsed.path : undefined
  } catch {
    return undefined
  }
}

async function resolveReadPath(environment: ExecutionEnvironment, workspacePath: string, rawPath: string): Promise<string> {
  try {
    return (await environment.resolvePath(rawPath, true)).path
  } catch {
    return isAbsolute(rawPath) ? resolve(rawPath) : resolve(workspacePath, rawPath)
  }
}

export function resolveWorkspacePath(workspacePath: string | undefined, homeDirectory: string): string {
  const requestedPath = workspacePath?.trim()
  if (!requestedPath) return resolve(homeDirectory)
  return isAbsolute(requestedPath) ? resolve(requestedPath) : resolve(homeDirectory, requestedPath)
}
