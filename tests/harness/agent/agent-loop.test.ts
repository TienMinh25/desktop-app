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
  notifyTodoUpdate() {},
}

function modelFor(turns: ChatStreamEvent[][]): ChatModel {
  let turnIndex = 0
  return {
    async *stream() {
      for (const event of turns[turnIndex++] ?? []) yield event
    },
  }
}

it("streams final assistant text and returns it in the conversation", async () => {
  const loop = new AgentLoop(modelFor([[{ type: "text.delta", text: "hello" }, { type: "stream.finished" }]]), new ToolRegistry())
  const deltas: string[] = []
  const result = await loop.run({ modelName: "test", messages: [{ role: "user", content: "hi" }], context, onTextDelta: (text) => deltas.push(text) })

  expect(deltas).toEqual(["hello"])
  expect(result.assistantText).toBe("hello")
  expect(result.messages.at(-1)).toEqual({ role: "assistant", content: "hello" })
})

it("reassembles fragmented tool calls, executes them, and continues the model turn", async () => {
  const registry = new ToolRegistry()
  let executedArgs: unknown
  const tool: HarnessTool = {
    definition: { type: "function", function: { name: "echo", description: "echo", parameters: { type: "object" } } },
    async execute(args) { executedArgs = args; return "echo result" },
  }
  registry.register(tool)
  const loop = new AgentLoop(modelFor([
    [
      { type: "tool-call.delta", index: 0, id: "call-1", name: "ec", argumentsDelta: "{\"text\":" },
      { type: "tool-call.delta", index: 0, name: "ho", argumentsDelta: "\"hello\"}" },
      { type: "stream.finished" },
    ],
    [{ type: "text.delta", text: "finished" }, { type: "stream.finished" }],
  ]), registry)

  const result = await loop.run({ modelName: "test", messages: [{ role: "user", content: "echo" }], context, onTextDelta() {} })

  expect(executedArgs).toEqual({ text: "hello" })
  expect(result.assistantText).toBe("finished")
  expect(result.messages.some((message) => message.role === "tool" && message.tool_call_id === "call-1" && message.content === "echo result")).toBe(true)
})

it("turns tool permission failures into model-visible tool errors", async () => {
  const registry = new ToolRegistry()
  registry.register({
    definition: { type: "function", function: { name: "write", description: "write", parameters: { type: "object" } } },
    async permissionRequests() { return [{ tool: "write", action: "write", resource: "file.txt", reason: "Write file" }] },
    async execute() { return "unexpected" },
  })
  const loop = new AgentLoop(modelFor([[
    { type: "tool-call.delta", index: 0, id: "call-1", name: "write", argumentsDelta: "{}" },
    { type: "stream.finished" },
  ], [{ type: "text.delta", text: "denied" }]]), registry)
  const deniedContext = { ...context, requirePermission: async () => { throw new Error("user denied") } }

  const result = await loop.run({ modelName: "test", messages: [{ role: "user", content: "write" }], context: deniedContext, onTextDelta() {} })

  expect(result.messages.some((message) => message.role === "tool" && message.content === "Tool error: user denied")).toBe(true)
})

it("continues beyond eight tool rounds until the model stops requesting tools", async () => {
  const registry = new ToolRegistry()
  let executions = 0
  registry.register({
    definition: { type: "function", function: { name: "echo", description: "echo", parameters: { type: "object" } } },
    async execute() { executions += 1; return "ok" },
  })
  const repeatedToolCall: ChatStreamEvent[] = [
    { type: "tool-call.delta", index: 0, id: "call-1", name: "echo", argumentsDelta: "{}" },
    { type: "stream.finished" },
  ]
  const loop = new AgentLoop(modelFor([
    ...Array.from({ length: 9 }, () => repeatedToolCall),
    [{ type: "text.delta", text: "finished" }, { type: "stream.finished" }],
  ]), registry)

  const result = await loop.run({ modelName: "test", messages: [{ role: "user", content: "loop" }], context, onTextDelta() {} })

  expect(executions).toBe(9)
  expect(result.assistantText).toBe("finished")
})
