import { expect, it } from "bun:test"
import type { ChatModel, ChatStreamEvent } from "../../../src/domain/chat/types"
import { ToolRegistry, type ToolContext, type HarnessTool } from "../../../src/harness/agent/tool-registry"
import { AgentLoop } from "../../../src/harness/agent/agent-loop"
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

function modelFor(turns: ChatStreamEvent[][]): ChatModel {
  let turnIndex = 0
  return {
    async *stream() {
      for (const event of turns[turnIndex++] ?? []) yield event
    },
  }
}

function callEvent(name: string, argumentsValue: unknown, callId = "call-1"): ChatStreamEvent {
  return {
    type: "response.output-items",
    items: [{ type: "function_call", id: `fc_${callId}`, call_id: callId, name, arguments: JSON.stringify(argumentsValue) }],
  }
}

const input = [{ role: "user" as const, content: "hello" }]

it("streams final assistant text and returns it in the conversation", async () => {
  const assistantMessage = { type: "message", role: "assistant", content: [{ type: "output_text", text: "hello" }] }
  const loop = new AgentLoop(new ToolRegistry())
  const deltas: string[] = []
  const result = await loop.run(modelFor([[{ type: "text.delta", text: "hello" }, { type: "response.output-items", items: [assistantMessage] }, { type: "stream.finished" }]]), {
    modelName: "test", messages: input, context, onTextDelta: (text) => deltas.push(text),
  })

  expect(deltas).toEqual(["hello"])
  expect(result.assistantText).toBe("hello")
  expect(result.messages.at(-1)).toEqual(assistantMessage)
})

it("executes a completed function call and continues the model turn", async () => {
  const registry = new ToolRegistry()
  let executedArgs: unknown
  const tool: HarnessTool = {
    definition: { type: "function", name: "echo", description: "echo", parameters: { type: "object" } },
    async execute(args) { executedArgs = args; return "echo result" },
  }
  registry.register(tool)
  const loop = new AgentLoop(registry)
  const finalMessage = { type: "message", role: "assistant", content: [{ type: "output_text", text: "finished" }] }
  const model = modelFor([
    [callEvent("echo", { text: "hello" }), { type: "stream.finished" }],
    [{ type: "text.delta", text: "finished" }, { type: "response.output-items", items: [finalMessage] }, { type: "stream.finished" }],
  ])
  const result = await loop.run(model, { modelName: "test", messages: input, context, onTextDelta() {} })

  expect(executedArgs).toEqual({ text: "hello" })
  expect(result.assistantText).toBe("finished")
  expect(result.messages).toContainEqual({ type: "function_call_output", call_id: "call-1", output: "echo result" })
})

it("turns tool permission failures into model-visible tool errors", async () => {
  const registry = new ToolRegistry()
  registry.register({
    definition: { type: "function", name: "write", description: "write", parameters: { type: "object" } },
    async permissionRequests() { return [{ tool: "write", action: "write", resource: "file.txt", reason: "Write file" }] },
    async execute() { return "unexpected" },
  })
  const loop = new AgentLoop(registry)
  const model = modelFor([
    [callEvent("write", {}), { type: "stream.finished" }],
    [{ type: "text.delta", text: "denied" }, { type: "stream.finished" }],
  ])
  const deniedContext = { ...context, requirePermission: async () => { throw new Error("user denied") } }

  const result = await loop.run(model, { modelName: "test", messages: input, context: deniedContext, onTextDelta() {} })

  expect(result.messages).toContainEqual({ type: "function_call_output", call_id: "call-1", output: "Tool error: user denied" })
})

it("continues beyond eight tool rounds until the model stops requesting tools", async () => {
  const registry = new ToolRegistry()
  let executions = 0
  registry.register({
    definition: { type: "function", name: "echo", description: "echo", parameters: { type: "object" } },
    async execute() { executions += 1; return "ok" },
  })
  const repeatedToolCall: ChatStreamEvent[] = [callEvent("echo", {}), { type: "stream.finished" }]
  const loop = new AgentLoop(registry)
  const model = modelFor([
    ...Array.from({ length: 9 }, () => repeatedToolCall),
    [{ type: "text.delta", text: "finished" }, { type: "stream.finished" }],
  ])

  const result = await loop.run(model, { modelName: "test", messages: input, context, onTextDelta() {} })

  expect(executions).toBe(9)
  expect(result.assistantText).toBe("finished")
})
