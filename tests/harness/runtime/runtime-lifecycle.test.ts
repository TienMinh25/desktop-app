import { expect, it } from "bun:test"
import type { HarnessEvent } from "../../../src/contracts/events"
import type { ChatModel, ChatStreamEvent } from "../../../src/domain/chat/types"
import { ToolRegistry } from "../../../src/harness/agent/tool-registry"
import type { HarnessTool } from "../../../src/harness/agent/tool-registry"
import { LocalExecutionEnvironment } from "../../../src/harness/execution/local-execution-environment"
import { PermissionManager } from "../../../src/harness/permissions/permission-manager"
import { HarnessRuntime } from "../../../src/harness/runtime"
import { InMemoryConversationStore } from "../../../src/harness/session/in-memory-conversation-store"
import { QuestionManager } from "../../../src/harness/interaction/question-manager"
import { questionTool } from "../../../src/harness/tools/question-tool"

class TrackingEnvironment extends LocalExecutionEnvironment {
  closed = false
  override close() { this.closed = true }
}

it("serializes prompts for the same session", async () => {
  let releaseFirst!: () => void
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
  let streamCount = 0
  let activeStreams = 0
  let maximumActiveStreams = 0
  const model: ChatModel = {
    async *stream(): AsyncIterable<ChatStreamEvent> {
      streamCount += 1
      activeStreams += 1
      maximumActiveStreams = Math.max(maximumActiveStreams, activeStreams)
      if (streamCount === 1) await firstGate
      yield { type: "stream.finished" }
      activeStreams -= 1
    },
  }
  const environments: TrackingEnvironment[] = []
  const completed: HarnessEvent[] = []
  let finish!: () => void
  const bothFinished = new Promise<void>((resolve) => { finish = resolve })
  const runtime = new HarnessRuntime({
    conversations: new InMemoryConversationStore(),
    tools: new ToolRegistry(),
    permissions: new PermissionManager(() => {}),
    createChatModel: () => model,
    createExecutionEnvironment(path) { const environment = new TrackingEnvironment(path); environments.push(environment); return environment },
    emit(event) { if (event.type === "chat.completed") { completed.push(event); if (completed.length === 2) finish() } },
  })
  const command = { type: "chat.submit" as const, requestId: "first", sessionId: "same-session", prompt: "one", model: "test", approvalMode: "manual" as const }

  runtime.submit(command)
  runtime.submit({ ...command, requestId: "second", prompt: "two" })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(streamCount).toBe(1)
  releaseFirst()
  await bothFinished

  expect(maximumActiveStreams).toBe(1)
  expect(environments).toHaveLength(2)
  expect(environments.every((environment) => environment.closed)).toBe(true)
})

it("emits chat.failed and closes the execution environment when model creation fails", async () => {
  const events: HarnessEvent[] = []
  let created: TrackingEnvironment | undefined
  let failed!: (message: string) => void
  const failure = new Promise<string>((resolve) => { failed = resolve })
  const runtime = new HarnessRuntime({
    conversations: new InMemoryConversationStore(),
    tools: new ToolRegistry(),
    permissions: new PermissionManager(() => {}),
    createChatModel() { throw new Error("model unavailable") },
    createExecutionEnvironment(path) { created = new TrackingEnvironment(path); return created },
    emit(event) { events.push(event); if (event.type === "chat.failed") failed(event.message) },
  })
  runtime.submit({ type: "chat.submit", requestId: "failed", sessionId: "session", prompt: "hello", model: "test", approvalMode: "manual" })

  expect(await failure).toBe("model unavailable")
  expect(created?.closed).toBe(true)
  expect(events.some((event) => event.type === "chat.completed")).toBe(false)
})

it("passes the selected approval mode from chat command through runtime to permission handling", async () => {
  const events: HarnessEvent[] = []
  let completed!: () => void
  const finished = new Promise<void>((resolve) => { completed = resolve })
  const tool: HarnessTool = {
    definition: { type: "function", function: { name: "write", description: "write", parameters: { type: "object" } } },
    async permissionRequests() { return [{ tool: "write", action: "write", resource: "file.txt", reason: "Write a file" }] },
    async execute() { return "written" },
  }
  const tools = new ToolRegistry()
  tools.register(tool)
  let modelTurn = 0
  const model: ChatModel = {
    async *stream(): AsyncIterable<ChatStreamEvent> {
      modelTurn += 1
      if (modelTurn === 1) {
        yield { type: "tool-call.delta", index: 0, id: "call-write", name: "write", argumentsDelta: "{}" }
        yield { type: "stream.finished" }
      } else {
        yield { type: "text.delta", text: "done" }
        yield { type: "stream.finished" }
      }
    },
  }
  const permissions = new PermissionManager((event) => {
    events.push(event)
    if (event.type === "permission.required") permissions.respond(event.permissionRequestId, "allow")
  })
  const runtime = new HarnessRuntime({
    conversations: new InMemoryConversationStore(),
    tools,
    permissions,
    createChatModel: () => model,
    createExecutionEnvironment: (path) => new TrackingEnvironment(path),
    emit(event) { events.push(event); if (event.type === "chat.completed") completed() },
  })

  runtime.submit({ type: "chat.submit", requestId: "approval", sessionId: "approval-session", prompt: "write", model: "test", approvalMode: "auto-safe" })
  await finished

  expect(events.some((event) => event.type === "permission.required" && event.tool === "write")).toBe(true)
  expect(events.some((event) => event.type === "tool.completed" && event.toolName === "write")).toBe(true)
})

it("routes an inline question answer back into the model tool result", async () => {
  const events: HarnessEvent[] = []
  let finish!: () => void
  let fail!: (error: Error) => void
  const completed = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject })
  let modelTurn = 0
  const answersSeenByModel: string[] = []
  const model: ChatModel = {
    async *stream(request): AsyncIterable<ChatStreamEvent> {
      modelTurn += 1
      if (modelTurn === 1) {
        yield { type: "tool-call.delta", index: 0, id: "call-question", name: "question", argumentsDelta: JSON.stringify({ prompt: "Which IPC transport should I use?", choices: ["MessagePort", "UtilityProcess"] }) }
      } else {
        const lastMessage = request.messages.at(-1)
        if (lastMessage?.role === "tool" && typeof lastMessage.content === "string") answersSeenByModel.push(lastMessage.content)
        yield { type: "text.delta", text: "Got it" }
      }
      yield { type: "stream.finished" }
    },
  }
  const tools = new ToolRegistry()
  tools.register(questionTool)
  const questions = new QuestionManager((event) => {
    events.push(event)
    if (event.type === "question.required") questions.respond(event.questionRequestId, "Keep UtilityProcess IPC")
  })
  const runtime = new HarnessRuntime({
    conversations: new InMemoryConversationStore(),
    tools,
    permissions: new PermissionManager((event) => events.push(event)),
    askUser(question) { return questions.ask(question) },
    createChatModel: () => model,
    createExecutionEnvironment: (path) => new TrackingEnvironment(path),
    emit(event) {
      events.push(event)
      if (event.type === "chat.completed") finish()
      if (event.type === "chat.failed") fail(new Error(event.message))
    },
  })

  runtime.submit({ type: "chat.submit", requestId: "question-request", sessionId: "question-session", prompt: "Ask me", model: "test", approvalMode: "manual" })
  await completed
  questions.close()

  expect(events.some((event) => event.type === "question.required" && event.prompt === "Which IPC transport should I use?" && event.choices?.length === 2)).toBe(true)
  expect(answersSeenByModel).toEqual(["Keep UtilityProcess IPC"])
  expect(events.some((event) => event.type === "chat.completed")).toBe(true)
})
