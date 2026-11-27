import { expect, it } from "bun:test"
import type { ChatModel, ChatStreamEvent, ResponseInputItem, ResponsesRequest } from "../../../src/domain/chat/types"
import { AgentLoop, MAX_MODEL_ROUNDS } from "../../../src/harness/agent/agent-loop"
import { ToolRegistry, type HarnessTool, type ToolContext } from "../../../src/harness/agent/tool-registry"
import { LocalExecutionEnvironment } from "../../../src/harness/execution/local-execution-environment"

const context: ToolContext = {
  workspacePath: process.cwd(),
  requestId: "request-1",
  sessionId: "session-1",
  environment: new LocalExecutionEnvironment(process.cwd()),
  async requirePermission() {},
  async askUser() { return "test answer" },
  todoScope: { type: "request", id: "request-1" },
  updateTodos() { return [] },
}

function modelFor(turns: ChatStreamEvent[][], seenRequests?: ResponsesRequest[]): ChatModel {
  let turnIndex = 0
  return {
    async *stream(request) {
      seenRequests?.push(request)
      for (const event of turns[turnIndex++] ?? []) yield event
    },
  }
}

function callItem(name: string, argumentsValue: unknown, callId = "call-1") {
  return { type: "function_call", id: `fc_${callId}`, call_id: callId, name, arguments: JSON.stringify(argumentsValue) }
}

function callEvent(name: string, argumentsValue: unknown, callId = "call-1"): ChatStreamEvent {
  return { type: "response.output-items", items: [callItem(name, argumentsValue, callId)] }
}

function messageEvent(text: string): ChatStreamEvent {
  return {
    type: "response.output-items",
    items: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
  }
}

function requestBuilder(registry: ToolRegistry, ctx = context) {
  return (steps: readonly ResponseInputItem[], options?: { final?: boolean }): ResponsesRequest => {
    const tools = options?.final ? [] : registry.definitions(ctx)
    return {
      project_id: 1,
      model: "test",
      input: [{ type: "message", role: "user", content: "hello" }, ...steps],
      ...(tools.length ? { tools } : {}),
    }
  }
}

it("streams final assistant text and returns finalBatch without persisting it", async () => {
  const assistantMessage = { type: "message", role: "assistant", content: [{ type: "output_text", text: "hello" }] }
  const registry = new ToolRegistry()
  const loop = new AgentLoop(registry)
  const deltas: string[] = []
  const persisted: ResponseInputItem[][] = []
  const result = await loop.run(
    modelFor([[{ type: "text.delta", text: "hello" }, { type: "response.output-items", items: [assistantMessage] }, { type: "stream.finished" }]]),
    {
      buildRequest: requestBuilder(registry),
      persistBatch: async (items) => { persisted.push([...items]) },
      context,
      onTextDelta: (text) => deltas.push(text),
    },
  )

  expect(deltas).toEqual(["hello"])
  expect(result.assistantText).toBe("hello")
  expect(result.finalBatch).toEqual([assistantMessage])
  expect(persisted).toEqual([])
})

it("rejects a stream that finishes without response.output-items", async () => {
  const registry = new ToolRegistry()
  const loop = new AgentLoop(registry)
  const model = modelFor([[{ type: "text.delta", text: "partial" }, { type: "stream.finished" }]])

  await expect(loop.run(model, {
    buildRequest: requestBuilder(registry),
    persistBatch: async () => {},
    context,
    onTextDelta() {},
  })).rejects.toThrow("response.output-items")
})

it("persists the call batch before running any tool and persists each output right after", async () => {
  const registry = new ToolRegistry()
  const timeline: string[] = []
  const tool: HarnessTool = {
    definition: { type: "function", name: "echo", description: "echo", parameters: { type: "object" } },
    async execute(args) {
      const value = (args as { label: string }).label
      timeline.push(`exec:${value}`)
      return `out:${value}`
    },
  }
  registry.register(tool)
  const loop = new AgentLoop(registry)
  const model = modelFor([
    [{ type: "response.output-items", items: [callItem("echo", { label: "a" }, "c1"), callItem("echo", { label: "b" }, "c2")] }, { type: "stream.finished" }],
    [{ type: "text.delta", text: "done" }, messageEvent("done"), { type: "stream.finished" }],
  ])

  const result = await loop.run(model, {
    buildRequest: requestBuilder(registry),
    persistBatch: async (items) => {
      await new Promise<void>((resolve) => setImmediate(resolve))
      timeline.push(`persist:${items.map((item) => item.type === "function_call"
        ? `call:${String(item.call_id)}`
        : item.type === "function_call_output" ? `out:${item.call_id}` : String(item.type)).join(",")}`)
    },
    context,
    onTextDelta() {},
  })

  expect(timeline).toEqual([
    "persist:call:c1,call:c2",
    "exec:a",
    "persist:out:c1",
    "exec:b",
    "persist:out:c2",
  ])
  expect(result.assistantText).toBe("done")
})

it("turns tool permission failures into model-visible tool errors", async () => {
  const registry = new ToolRegistry()
  registry.register({
    definition: { type: "function", name: "write", description: "write", parameters: { type: "object" } },
    async permissionRequests() { return [{ tool: "write", action: "write", resource: "file.txt", reason: "Write file" }] },
    async execute() { return "unexpected" },
  })
  const persisted: ResponseInputItem[][] = []
  const loop = new AgentLoop(registry)
  const model = modelFor([
    [callEvent("write", {}), { type: "stream.finished" }],
    [{ type: "text.delta", text: "denied" }, messageEvent("denied"), { type: "stream.finished" }],
  ])
  const deniedContext = { ...context, requirePermission: async () => { throw new Error("user denied") } }

  await loop.run(model, {
    buildRequest: requestBuilder(registry, deniedContext),
    persistBatch: async (items) => { persisted.push([...items]) },
    context: deniedContext,
    onTextDelta() {},
  })

  expect(persisted.flat()).toContainEqual({ type: "function_call_output", call_id: "call-1", output: "Tool error: user denied" })
})

it("caps tool rounds at MAX_MODEL_ROUNDS with a tool-less final round", async () => {
  const registry = new ToolRegistry()
  let executions = 0
  registry.register({
    definition: { type: "function", name: "echo", description: "echo", parameters: { type: "object" } },
    async execute() { executions += 1; return "ok" },
  })
  const seenRequests: ResponsesRequest[] = []
  const finalFlags: boolean[] = []
  const turns: ChatStreamEvent[][] = [
    ...Array.from({ length: MAX_MODEL_ROUNDS - 1 }, (_, index) => [callEvent("echo", {}, `c-${index + 1}`), { type: "stream.finished" as const }]),
    [{ type: "text.delta", text: "final answer" }, messageEvent("final answer"), { type: "stream.finished" }],
  ]
  const loop = new AgentLoop(registry)

  const result = await loop.run(modelFor(turns, seenRequests), {
    buildRequest: (steps, options) => {
      finalFlags.push(Boolean(options?.final))
      return requestBuilder(registry)(steps, options)
    },
    persistBatch: async () => {},
    context,
    onTextDelta() {},
  })

  expect(executions).toBe(24)
  expect(seenRequests).toHaveLength(25)
  expect(finalFlags.slice(0, -1).every((flag) => !flag)).toBe(true)
  expect(finalFlags.at(-1)).toBe(true)
  expect(seenRequests.at(-1)?.tools).toBeUndefined()
  expect(result.assistantText).toBe("final answer")
})

it("rejects a batch with more than MAX_TOOL_CALLS_PER_BATCH calls before persisting or running", async () => {
  const registry = new ToolRegistry()
  let executions = 0
  registry.register({
    definition: { type: "function", name: "echo", description: "echo", parameters: { type: "object" } },
    async execute() { executions += 1; return "ok" },
  })
  let persistCalls = 0
  const tooManyCalls = Array.from({ length: 17 }, (_, index) => callItem("echo", {}, `c-${index + 1}`))
  const loop = new AgentLoop(registry)

  await expect(loop.run(modelFor([[{ type: "response.output-items", items: tooManyCalls }, { type: "stream.finished" }]]), {
    buildRequest: requestBuilder(registry),
    persistBatch: async () => { persistCalls += 1 },
    context,
    onTextDelta() {},
  })).rejects.toThrow("limit 16")

  expect(persistCalls).toBe(0)
  expect(executions).toBe(0)
})

it("rejects duplicate call_id in one batch before persisting or running", async () => {
  const registry = new ToolRegistry()
  let executions = 0
  registry.register({
    definition: { type: "function", name: "echo", description: "echo", parameters: { type: "object" } },
    async execute() { executions += 1; return "ok" },
  })
  let persistCalls = 0
  const loop = new AgentLoop(registry)

  await expect(loop.run(modelFor([[
    { type: "response.output-items", items: [callItem("echo", {}, "dup"), callItem("echo", {}, "dup")] },
    { type: "stream.finished" },
  ]]), {
    buildRequest: requestBuilder(registry),
    persistBatch: async () => { persistCalls += 1 },
    context,
    onTextDelta() {},
  })).rejects.toThrow("duplicate tool call_id: dup")

  expect(persistCalls).toBe(0)
  expect(executions).toBe(0)
})

it("rejects an unknown or unadvertised tool before persisting or running", async () => {
  const registry = new ToolRegistry()
  let executions = 0
  registry.register({
    definition: { type: "function", name: "echo", description: "echo", parameters: { type: "object" } },
    async execute() { executions += 1; return "ok" },
  })
  let persistCalls = 0
  const loop = new AgentLoop(registry)

  await expect(loop.run(modelFor([[callEvent("nonexistent", {}, "c1"), { type: "stream.finished" }]]), {
    buildRequest: requestBuilder(registry),
    persistBatch: async () => { persistCalls += 1 },
    context,
    onTextDelta() {},
  })).rejects.toThrow("unadvertised tool: nonexistent")

  expect(persistCalls).toBe(0)
  expect(executions).toBe(0)
})

it("propagates persist failures without catching them as tool errors", async () => {
  const registry = new ToolRegistry()
  let executions = 0
  registry.register({
    definition: { type: "function", name: "echo", description: "echo", parameters: { type: "object" } },
    async execute() { executions += 1; return "ok" },
  })
  const loop = new AgentLoop(registry)
  let persistCount = 0
  const toolFailed: string[] = []

  await expect(loop.run(modelFor([[callEvent("echo", {}, "c1"), { type: "stream.finished" }]]), {
    buildRequest: requestBuilder(registry),
    persistBatch: async () => {
      persistCount += 1
      if (persistCount === 2) throw new Error("disk full")
    },
    context,
    onTextDelta() {},
    onToolFailed(_id, _name, msg) { toolFailed.push(msg) },
  })).rejects.toThrow("disk full")

  expect(executions).toBe(1)
  expect(toolFailed).toEqual([])
})

it("keeps original tool media output in memory for subsequent rounds", async () => {
  const registry = new ToolRegistry()
  const mediaOutput = [
    { type: "input_text" as const, text: "Read file: pic.png (PNG image)." },
    { type: "input_image" as const, image_url: "data:image/png;base64,iVBORw==", detail: "auto" as const },
  ]
  registry.register({
    definition: { type: "function", name: "read", description: "read", parameters: { type: "object" } },
    async execute() { return mediaOutput },
  })
  const seenRequests: ResponsesRequest[] = []
  const loop = new AgentLoop(registry)

  await loop.run(
    modelFor([
      [callEvent("read", { path: "pic.png" }, "c1"), { type: "stream.finished" }],
      [messageEvent("saw image"), { type: "stream.finished" }],
    ], seenRequests),
    {
      buildRequest: requestBuilder(registry),
      persistBatch: async () => {},
      context,
      onTextDelta() {},
    },
  )

  expect(seenRequests[1]?.input).toContainEqual({ type: "function_call_output", call_id: "c1", output: mediaOutput })
})

it("stops before the first side effect if the call batch cannot be committed", async () => {
  const registry = new ToolRegistry()
  let executions = 0
  registry.register({
    definition: { type: "function", name: "echo", description: "echo", parameters: { type: "object" } },
    async execute() { executions += 1; return "ok" },
  })
  await expect(new AgentLoop(registry).run(modelFor([[callEvent("echo", {})]]), {
    buildRequest: requestBuilder(registry),
    persistBatch: async () => { throw new Error("commit failed") },
    context,
    onTextDelta() {},
  })).rejects.toThrow("commit failed")
  expect(executions).toBe(0)
})

it("rejects a repeated call ID from a later round before a second execution", async () => {
  const registry = new ToolRegistry()
  let executions = 0
  registry.register({
    definition: { type: "function", name: "echo", description: "echo", parameters: { type: "object" } },
    async execute() { executions += 1; return "ok" },
  })
  const calls = [callEvent("echo", {})]
  const persisted: ResponseInputItem[][] = []
  await expect(new AgentLoop(registry).run(modelFor([calls, calls]), {
    buildRequest: requestBuilder(registry),
    persistBatch: async (items) => { persisted.push([...items]) },
    context,
    onTextDelta() {},
  })).rejects.toThrow("duplicate tool call_id")
  expect(executions).toBe(1)
  expect(persisted).toHaveLength(2)
})

it("rejects local-only item types from the model before persisting", async () => {
  const ref = { type: "ccodex_media_ref", kind: "file", name: "x.pdf", mime: "application/pdf", bytes: 5, turnRead: true, path: "/etc/x.pdf" }
  const cases = [
    { type: "function_call_output", call_id: "c1", output: [ref] },
    ref,
    { type: "message", role: "assistant", content: [ref] },
  ]
  for (const item of cases) {
    const registry = new ToolRegistry()
    const persisted: ResponseInputItem[][] = []
    await expect(new AgentLoop(registry).run(
      modelFor([[{ type: "response.output-items", items: [item] } as never, { type: "stream.finished" }]]),
      { buildRequest: requestBuilder(registry), persistBatch: async (items) => { persisted.push([...items]) }, context, onTextDelta() {} },
    )).rejects.toThrow("local-only item type")
    expect(persisted).toEqual([])
  }
})
