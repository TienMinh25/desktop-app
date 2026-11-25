import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "bun:test"
import type { HarnessEvent } from "../../../src/contracts/events"
import type { SubmitPromptCommand } from "../../../src/contracts/commands"
import type { ChatModel, ChatStreamEvent, ResponsesRequest } from "../../../src/domain/chat/types"
import { ToolRegistry, type HarnessTool } from "../../../src/harness/agent/tool-registry"
import { AGENTS_MD_MAX_CHARS } from "../../../src/harness/context/agents-md"
import { LocalExecutionEnvironment } from "../../../src/harness/execution/local-execution-environment"
import { QuestionManager } from "../../../src/harness/interaction/question-manager"
import { PermissionManager } from "../../../src/harness/permissions/permission-manager"
import { HarnessRuntime } from "../../../src/harness/runtime"
import { InMemoryTurnStore } from "../../../src/harness/session/in-memory-turn-store"
import type { FinishTurnInput, TurnHandle, TurnStore } from "../../../src/harness/session/turn-store"
import { questionTool } from "../../../src/harness/tools/question-tool"
import { readTool } from "../../../src/harness/tools/read-tool"

class TrackingEnvironment extends LocalExecutionEnvironment {
  closed = false
  override close() { this.closed = true }
}

function functionCall(name: string, argumentsValue: unknown, callId: string): ChatStreamEvent {
  return { type: "response.output-items", items: [{ type: "function_call", id: `fc_${callId}`, call_id: callId, name, arguments: JSON.stringify(argumentsValue) }] }
}

function assistantOutput(text: string): ChatStreamEvent {
  return { type: "response.output-items", items: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] }
}

it("serializes prompts for the same session", async () => {
  let releaseFirst!: () => void
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
  let markFirstStarted!: () => void
  const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve })
  let streamCount = 0
  let activeStreams = 0
  let maximumActiveStreams = 0
  const model: ChatModel = {
    async *stream(): AsyncIterable<ChatStreamEvent> {
      streamCount += 1
      activeStreams += 1
      maximumActiveStreams = Math.max(maximumActiveStreams, activeStreams)
      if (streamCount === 1) {
        markFirstStarted()
        await firstGate
      }
      yield assistantOutput("ok")
      yield { type: "stream.finished" }
      activeStreams -= 1
    },
  }
  const environments: TrackingEnvironment[] = []
  const queued: string[] = []
  const completed: HarnessEvent[] = []
  let finish!: () => void
  const bothFinished = new Promise<void>((resolve) => { finish = resolve })
  const runtime = new HarnessRuntime({
    turns: new InMemoryTurnStore(),
    tools: new ToolRegistry(),
    permissions: new PermissionManager(() => {}),
    createChatModel: () => model,
    createExecutionEnvironment(path) { const environment = new TrackingEnvironment(path); environments.push(environment); return environment },
    emit(event) {
      if (event.type === "chat.queued") queued.push(event.requestId)
      if (event.type === "chat.completed") { completed.push(event); if (completed.length === 2) finish() }
    },
  })
  const command = { type: "chat.submit" as const, requestId: "first", sessionId: "same-session", prompt: "one", model: "test", approvalMode: "manual" as const }

  runtime.submit(command)
  runtime.submit(command)
  runtime.submit({ ...command, requestId: "second", prompt: "two" })
  await firstStarted
  expect(streamCount).toBe(1)
  releaseFirst()
  await bothFinished

  expect(maximumActiveStreams).toBe(1)
  expect(queued).toEqual(["second"])
  expect(environments).toHaveLength(2)
  expect(environments.every((environment) => environment.closed)).toBe(true)
})

it("emits chat.failed and closes the execution environment when model creation fails", async () => {
  const events: HarnessEvent[] = []
  let created: TrackingEnvironment | undefined
  let failed!: (message: string) => void
  const failure = new Promise<string>((resolve) => { failed = resolve })
  const store = new InMemoryTurnStore()
  const runtime = new HarnessRuntime({
    turns: store,
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
  expect(events.at(-1)).toMatchObject({ type: "chat.failed", prompt: "hello" })
  const { turn } = store.beginTurn({ sessionId: "session", clientRequestId: "failed", prompt: "hello", workspacePath: process.cwd() })
  expect(store.getTurnMetadata("session", turn.assistantMessageId)).toMatchObject({ state: "failed", errorMessage: "model unavailable" })
})

it("commits model aborts as failed and closes the model", async () => {
  const store = new InMemoryTurnStore()
  const events: HarnessEvent[] = []
  const command: SubmitPromptCommand = { type: "chat.submit", requestId: "aborted", sessionId: "s1", prompt: "hello", model: "test", approvalMode: "manual" }
  let settle!: () => void
  const settled = new Promise<void>((resolve) => { settle = resolve })
  let closed = false
  const runtime = new HarnessRuntime({
    turns: store,
    tools: new ToolRegistry(),
    permissions: new PermissionManager(() => {}),
    createChatModel: () => ({
      async *stream() { throw new DOMException("Aborted by the transport", "AbortError") },
      async close() { closed = true },
    }),
    createExecutionEnvironment: (path) => new TrackingEnvironment(path),
    emit(event) {
      events.push(event)
      if (event.type === "chat.failed" || event.type === "chat.completed") settle()
    },
  })

  runtime.submit(command)
  await settled

  expect(closed).toBe(true)
  expect(events.map((event) => event.type)).toEqual(["chat.started", "chat.failed"])
  const { turn } = store.beginTurn({ sessionId: command.sessionId, clientRequestId: command.requestId, prompt: command.prompt, workspacePath: process.cwd() })
  expect(store.getTurnMetadata(command.sessionId, turn.assistantMessageId)).toMatchObject({ state: "failed", errorMessage: "Aborted by the transport" })
})

it("passes the selected approval mode from chat command through runtime to permission handling", async () => {
  const events: HarnessEvent[] = []
  let completed!: () => void
  const finished = new Promise<void>((resolve) => { completed = resolve })
  const tool: HarnessTool = {
    definition: { type: "function", name: "write", description: "write", parameters: { type: "object" } },
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
        yield functionCall("write", {}, "call-write")
        yield { type: "stream.finished" }
      } else {
        yield { type: "text.delta", text: "done" }
        yield assistantOutput("done")
        yield { type: "stream.finished" }
      }
    },
  }
  const permissions = new PermissionManager((event) => {
    events.push(event)
    if (event.type === "permission.required") permissions.respond(event.permissionRequestId, "allow")
  })
  const runtime = new HarnessRuntime({
    turns: new InMemoryTurnStore(),
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
        yield functionCall("question", { prompt: "Which IPC transport should I use?", choices: ["MessagePort", "UtilityProcess"] }, "call-question")
      } else {
        const lastMessage = request.input.at(-1)
        if (lastMessage?.type === "function_call_output" && typeof lastMessage.output === "string") answersSeenByModel.push(lastMessage.output)
        yield { type: "text.delta", text: "Got it" }
        yield assistantOutput("Got it")
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
    turns: new InMemoryTurnStore(),
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

it("emits chat.started only after beginTurn succeeds and turns TurnConflictError into chat.failed", async () => {
  const store = new InMemoryTurnStore()
  // Hold an already running turn in s1 so the submitted prompt hits TurnConflictError
  store.beginTurn({ sessionId: "s1", clientRequestId: "existing", prompt: "busy", workspacePath: process.cwd() })

  const events: HarnessEvent[] = []
  let done!: () => void
  const settled = new Promise<void>((resolve) => { done = resolve })
  const runtime = new HarnessRuntime({
    turns: store,
    tools: new ToolRegistry(),
    permissions: new PermissionManager(() => {}),
    createChatModel: () => ({ async *stream() { yield assistantOutput("never"); yield { type: "stream.finished" } } }),
    createExecutionEnvironment: (path) => new TrackingEnvironment(path),
    emit(event) {
      events.push(event)
      if (event.type === "chat.failed" || event.type === "chat.completed") done()
    },
  })

  runtime.submit({ type: "chat.submit", requestId: "req-conflict", sessionId: "s1", prompt: "hello", model: "test", approvalMode: "manual" })
  await settled

  expect(events.map((event) => event.type)).toEqual(["chat.failed"])
  expect(events[0]?.type === "chat.failed" && events[0].message).toContain("already has a running turn")
})

it.each(["running", "completed", "failed", "interrupted"] as const)("ignores a repeated request for a %s turn", (state) => {
  const store = new InMemoryTurnStore()
  const command: SubmitPromptCommand = { type: "chat.submit", requestId: "repeated", sessionId: "s1", prompt: "hello", model: "test", approvalMode: "manual" }
  const { turn } = store.beginTurn({ sessionId: command.sessionId, clientRequestId: command.requestId, prompt: command.prompt, workspacePath: process.cwd() })
  if (state === "completed" || state === "failed") store.finishTurn(turn, { state })
  if (state === "interrupted") store.recoverInterrupted()

  const events: HarnessEvent[] = []
  const runtime = new HarnessRuntime({
    turns: store,
    tools: new ToolRegistry(),
    permissions: new PermissionManager(() => {}),
    createChatModel() { throw new Error("A replay must not create a model") },
    createExecutionEnvironment: (path) => new TrackingEnvironment(path),
    emit(event) { events.push(event) },
  })

  runtime.submit(command)

  expect(events).toEqual([])
  expect(store.getTurnMetadata(command.sessionId, turn.assistantMessageId)?.state).toBe(state)
})

it("emits context.warning after chat.started when AGENTS.md triggers a warning", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ccodex-agents-warn-"))
  try {
    writeFileSync(join(dir, "AGENTS.md"), "x".repeat(AGENTS_MD_MAX_CHARS + 10), "utf8")
    const events: HarnessEvent[] = []
    let done!: () => void
    const settled = new Promise<void>((resolve) => { done = resolve })
    const runtime = new HarnessRuntime({
      turns: new InMemoryTurnStore(),
      tools: new ToolRegistry(),
      permissions: new PermissionManager(() => {}),
      createChatModel: () => ({ async *stream() { yield assistantOutput("ok"); yield { type: "stream.finished" } } }),
      createExecutionEnvironment: (path) => new TrackingEnvironment(path),
      emit(event) {
        events.push(event)
        if (event.type === "chat.completed" || event.type === "chat.failed") done()
      },
    })

    runtime.submit({ type: "chat.submit", requestId: "req-warn", sessionId: "s-warn", prompt: "hi", model: "test", workspacePath: dir, approvalMode: "manual" })
    await settled

    expect(events.map((event) => event.type)).toEqual(["chat.started", "context.warning", "chat.completed"])
    const warning = events.find((event) => event.type === "context.warning")
    expect(warning?.type === "context.warning" && warning.message).toContain("AGENTS.md")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it("calls finishTurn exactly once and emits chat.failed (never chat.completed) when finishTurn throws", async () => {
  const backing = new InMemoryTurnStore()
  let finishCalls = 0
  const store: TurnStore = {
    recoverInterrupted: () => backing.recoverInterrupted(),
    beginTurn: (input) => backing.beginTurn(input),
    appendSteps: (turn, items, blobs) => backing.appendSteps(turn, items, blobs),
    finishTurn(_turn: TurnHandle, _input: FinishTurnInput) {
      finishCalls += 1
      throw new Error("sqlite write failed")
    },
    pruneOrphanBlobs: () => backing.pruneOrphanBlobs(),
    loadBlob: (sha) => backing.loadBlob(sha),
  }
  const events: HarnessEvent[] = []
  let done!: () => void
  const settled = new Promise<void>((resolve) => { done = resolve })
  const runtime = new HarnessRuntime({
    turns: store,
    tools: new ToolRegistry(),
    permissions: new PermissionManager(() => {}),
    createChatModel: () => ({ async *stream() { yield assistantOutput("answer"); yield { type: "stream.finished" } } }),
    createExecutionEnvironment: (path) => new TrackingEnvironment(path),
    emit(event) {
      events.push(event)
      if (event.type === "chat.completed" || event.type === "chat.failed") done()
    },
  })

  runtime.submit({ type: "chat.submit", requestId: "req-finish-err", sessionId: "s-finish", prompt: "hi", model: "test", approvalMode: "manual" })
  await settled

  expect(finishCalls).toBe(1)
  expect(events.some((event) => event.type === "chat.completed")).toBe(false)
  expect(events.at(-1)).toMatchObject({ type: "chat.failed", message: "sqlite write failed" })
})

it("emits chat.failed and never chat.completed when appendSteps fails", async () => {
  const backing = new InMemoryTurnStore()
  let finishCalls = 0
  let finishState: FinishTurnInput["state"] | undefined
  const store: TurnStore = {
    recoverInterrupted: () => backing.recoverInterrupted(),
    beginTurn: (input) => backing.beginTurn(input),
    appendSteps() { throw new Error("disk full") },
    finishTurn(turn, input) {
      finishCalls += 1
      finishState = input.state
      backing.finishTurn(turn, input)
    },
    pruneOrphanBlobs: () => backing.pruneOrphanBlobs(),
    loadBlob: (sha) => backing.loadBlob(sha),
  }
  const tools = new ToolRegistry()
  tools.register({
    definition: { type: "function", name: "echo", description: "echo", parameters: { type: "object" } },
    async execute() { return "ok" },
  })
  const events: HarnessEvent[] = []
  let done!: () => void
  const settled = new Promise<void>((resolve) => { done = resolve })
  const runtime = new HarnessRuntime({
    turns: store,
    tools,
    permissions: new PermissionManager(() => {}),
    createChatModel: () => ({ async *stream() { yield functionCall("echo", {}, "c1"); yield { type: "stream.finished" } } }),
    createExecutionEnvironment: (path) => new TrackingEnvironment(path),
    emit(event) {
      events.push(event)
      if (event.type === "chat.completed" || event.type === "chat.failed") done()
    },
  })

  runtime.submit({ type: "chat.submit", requestId: "req-append-err", sessionId: "s-append", prompt: "hi", model: "test", approvalMode: "manual" })
  await settled

  expect(finishCalls).toBe(1)
  expect(finishState).toBe("failed")
  expect(events.map((event) => event.type)).toEqual(["chat.started", "chat.failed"])
  expect(events.at(-1)).toMatchObject({ type: "chat.failed", message: "disk full" })
})

it("stops before executing a tool when the session disappears", async () => {
  const store = new InMemoryTurnStore()
  let executions = 0
  const tools = new ToolRegistry()
  tools.register({
    definition: { type: "function", name: "echo", description: "echo", parameters: { type: "object" } },
    async execute() { executions += 1; return "ok" },
  })
  const events: HarnessEvent[] = []
  let done!: () => void
  const settled = new Promise<void>((resolve) => { done = resolve })
  const runtime = new HarnessRuntime({
    turns: store,
    tools,
    permissions: new PermissionManager(() => {}),
    createChatModel: () => ({ async *stream() {
      store.deleteSession("s-gone")
      yield functionCall("echo", {}, "c1")
      yield { type: "stream.finished" }
    } }),
    createExecutionEnvironment: (path) => new TrackingEnvironment(path),
    emit(event) {
      events.push(event)
      if (event.type === "chat.completed" || event.type === "chat.failed") done()
    },
  })

  runtime.submit({ type: "chat.submit", requestId: "req-gone", sessionId: "s-gone", prompt: "hi", model: "test", approvalMode: "manual" })
  await settled

  expect(events.map((event) => event.type)).toEqual(["chat.started", "chat.failed"])
  expect(executions).toBe(0)
  expect(events.at(-1)).toMatchObject({ type: "chat.failed", message: "Session was deleted." })
})

it("stores read media as blob for small images and path reference for PDFs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ccodex-read-media-"))
  try {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])
    const pdfBytes = Buffer.from("%PDF-1.7\nhello pdf\n")
    writeFileSync(join(dir, "shot.png"), pngBytes)
    writeFileSync(join(dir, "spec.pdf"), pdfBytes)
    symlinkSync("spec.pdf", join(dir, "document.pdf"))

    const store = new InMemoryTurnStore()
    let begunAssistantId = 0
    const trackedStore: TurnStore = {
      recoverInterrupted: () => store.recoverInterrupted(),
      beginTurn(input) {
        const result = store.beginTurn(input)
        begunAssistantId = result.turn.assistantMessageId
        return result
      },
      appendSteps: (turn, items, blobs) => store.appendSteps(turn, items, blobs),
      finishTurn: (turn, input) => store.finishTurn(turn, input),
      pruneOrphanBlobs: () => store.pruneOrphanBlobs(),
      loadBlob: (sha) => store.loadBlob(sha),
    }

    const tools = new ToolRegistry()
    tools.register(readTool)
    const seenRequests: ResponsesRequest[] = []
    let round = 0
    const model: ChatModel = {
      async *stream(request) {
        seenRequests.push(request)
        round += 1
        if (round === 1) {
          yield {
            type: "response.output-items",
            items: [
              { type: "function_call", id: "fc_img", call_id: "c_img", name: "read", arguments: JSON.stringify({ path: "shot.png" }) },
              { type: "function_call", id: "fc_pdf", call_id: "c_pdf", name: "read", arguments: JSON.stringify({ path: "document.pdf" }) },
            ],
          }
        } else {
          yield assistantOutput("Read both files")
        }
        yield { type: "stream.finished" }
      },
    }

    let done!: () => void
    let fail!: (error: Error) => void
    const completed = new Promise<void>((resolve, reject) => { done = resolve; fail = reject })
    const runtime = new HarnessRuntime({
      turns: trackedStore,
      tools,
      permissions: new PermissionManager(() => {}),
      supportsMediaInput: () => true,
      createChatModel: () => model,
      createExecutionEnvironment: (path) => new TrackingEnvironment(path),
      emit(event) {
        if (event.type === "chat.completed") done()
        if (event.type === "chat.failed") fail(new Error(event.message))
      },
    })

    runtime.submit({
      type: "chat.submit",
      requestId: "req-media",
      sessionId: "s-media",
      prompt: "Read both",
      model: "claude-sonnet",
      workspacePath: dir,
      approvalMode: "full-access",
    })
    await completed

    const artifacts = store.getArtifacts("s-media", begunAssistantId)
    expect(artifacts).toHaveLength(2)
    const imageArtifact = artifacts.find((item) => item.name === "shot.png")
    const pdfArtifact = artifacts.find((item) => item.name === "spec.pdf")
    expect(imageArtifact?.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(imageArtifact?.path).toBe(`media:${imageArtifact?.sha256}`)
    expect(store.loadBlob(imageArtifact!.sha256!)).toEqual(pngBytes)
    expect(pdfArtifact?.sha256).toBeNull()
    expect(pdfArtifact?.path).toBe(realpathSync(join(dir, "spec.pdf")))

    // Second round still received inline base64 data URLs from in-memory steps
    const round2Outputs = seenRequests[1]?.input.filter((item) => item.type === "function_call_output")
    expect(JSON.stringify(round2Outputs)).toContain(`data:image/png;base64,${pngBytes.toString("base64")}`)
    expect(JSON.stringify(round2Outputs)).toContain(`data:application/pdf;base64,${pdfBytes.toString("base64")}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
