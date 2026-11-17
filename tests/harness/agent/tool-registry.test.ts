import { expect, it } from "bun:test"
import { ToolRegistry, type HarnessTool, type ToolContext } from "../../../src/harness/agent/tool-registry"
import { LocalExecutionEnvironment } from "../../../src/harness/execution/local-execution-environment"

const root = process.cwd()

function context(requirePermission: ToolContext["requirePermission"]): ToolContext {
  return {
    workspacePath: root,
    requestId: "request-1",
    sessionId: "session-1",
    environment: new LocalExecutionEnvironment(root),
    requirePermission,
    async askUser() { return "test answer" },
    todoScope: { type: "request", id: "request-1" },
    updateTodos() { return [] },
  }
}

it("asks for prepared permissions before executing the tool", async () => {
  const order: string[] = []
  const tool: HarnessTool = {
    definition: { type: "function", name: "write", description: "write", parameters: { type: "object" } },
    async prepare() {
      order.push("prepare")
      return { permissionRequests: [{ tool: "write", action: "write", resource: `${root}/file.txt`, reason: "Write file" }], data: "prepared" }
    },
    async execute(_args, _context, prepared) {
      order.push(`execute:${String(prepared)}`)
      return "wrote file"
    },
  }
  const registry = new ToolRegistry()
  registry.register(tool)

  const message = await registry.execute("write", "{}", context(async () => { order.push("permission") }), "call-1")

  expect(order).toEqual(["prepare", "permission", "execute:prepared"])
  expect(message).toEqual({ type: "function_call_output", call_id: "call-1", output: "wrote file" })
})

it("does not execute a tool when permission is denied", async () => {
  let executed = false
  const tool: HarnessTool = {
    definition: { type: "function", name: "write", description: "write", parameters: { type: "object" } },
    async prepare() { return { permissionRequests: [{ tool: "write", action: "write", resource: "file.txt", reason: "Write file" }] } },
    async execute() { executed = true; return "unexpected" },
  }
  const registry = new ToolRegistry()
  registry.register(tool)

  await expect(registry.execute("write", "{}", context(async () => { throw new Error("denied") }), "call-1")).rejects.toThrow("denied")
  expect(executed).toBe(false)
})

it("reports malformed arguments and unknown tool names before executing", async () => {
  const registry = new ToolRegistry()
  await expect(registry.execute("missing", "{}", context(async () => {}), "call-1")).rejects.toThrow("Unknown tool")
  const tool: HarnessTool = {
    definition: { type: "function", name: "read", description: "read", parameters: { type: "object" } },
    async execute() { return "unexpected" },
  }
  registry.register(tool)
  await expect(registry.execute("read", "{", context(async () => {}), "call-1")).rejects.toThrow("invalid JSON arguments")
})
