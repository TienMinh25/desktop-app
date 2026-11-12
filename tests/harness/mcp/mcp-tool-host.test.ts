import { expect, it } from "bun:test"
import { resolve } from "node:path"
import { McpToolHost } from "../../../src/harness/mcp/mcp-tool-host"
import { createToolTestContext } from "../tools/tool-test-context"

const fixture = resolve(import.meta.dir, "../../fixtures/mcp-stdio-server.mjs")

it("exposes validated MCP tools as namespaced tools requiring permission", async () => {
  const testContext = await createToolTestContext()
  const host = new McpToolHost(JSON.stringify([{ name: "local", command: process.execPath, args: [fixture] }]))
  try {
    const tools = await host.tools(testContext.context.workspacePath)
    expect(tools.map((tool) => tool.definition.function.name)).toEqual(["mcp_local_echo"])
    const prepared = await tools[0]!.prepare!({ text: "hello" }, testContext.context)
    expect(prepared.permissionRequests[0]).toMatchObject({ tool: "mcp", reason: "This invokes a configured external MCP server." })
    expect(await tools[0]!.execute({ text: "hello" }, testContext.context, prepared.data)).toBe("echo:hello")
    await expect(tools[0]!.execute(["not", "an object"], testContext.context)).rejects.toThrow("arguments must be an object")
  } finally {
    host.close()
    await testContext.cleanup()
  }
})

it("rejects malformed, duplicate, and non-object MCP tool schemas", async () => {
  const invalidJson = new McpToolHost("not json")
  await expect(invalidJson.tools(process.cwd())).rejects.toThrow()
  const duplicateNames = new McpToolHost(JSON.stringify([
    { name: "local", command: process.execPath, args: [fixture] },
    { name: "local", command: process.execPath, args: [fixture] },
  ]))
  await expect(duplicateNames.tools(process.cwd())).rejects.toThrow("Duplicate MCP server name")

  const invalidCwd = new McpToolHost(JSON.stringify([{ name: "local", command: process.execPath, cwd: 5 }]))
  await expect(invalidCwd.tools(process.cwd())).rejects.toThrow("cwd must be a string")
})
