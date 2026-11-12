import { expect, it } from "bun:test"
import { resolve } from "node:path"
import { McpStdioClient } from "../../../src/harness/mcp/mcp-stdio-client"

const fixture = resolve(import.meta.dir, "../../fixtures/mcp-stdio-server.mjs")

it("performs the MCP handshake, lists tools, and calls a tool over stdio", async () => {
  const client = new McpStdioClient(process.execPath, [fixture], process.cwd(), process.env)
  try {
    const tools = await client.connect()
    expect(tools.map((tool) => tool.name)).toEqual(["echo"])
    expect(await client.callTool("echo", { text: "hello" })).toBe("echo:hello")
  } finally { client.close() }
})

it("rejects an unsupported protocol version and reports server tool errors", async () => {
  const incompatible = new McpStdioClient(process.execPath, [fixture, "bad-version"], process.cwd(), process.env)
  await expect(incompatible.connect()).rejects.toThrow("protocol version is not supported")
  incompatible.close()

  const client = new McpStdioClient(process.execPath, [fixture], process.cwd(), process.env)
  try {
    await client.connect()
    await expect(client.callTool("echo", { fail: true })).rejects.toThrow("server rejected call")
  } finally { client.close() }
})

it("fails pending requests when the server writes malformed JSON", async () => {
  const client = new McpStdioClient(process.execPath, [fixture, "bad-json"], process.cwd(), process.env, 500)
  try {
    await expect(client.connect()).rejects.toThrow("timed out")
  } finally { client.close() }
})

it("rejects malformed initialization and tool-list result shapes", async () => {
  const badInitialization = new McpStdioClient(process.execPath, [fixture, "bad-initialize"], process.cwd(), process.env, 500)
  await expect(badInitialization.connect()).rejects.toThrow()
  badInitialization.close()

  const badTools = new McpStdioClient(process.execPath, [fixture, "bad-tools"], process.cwd(), process.env, 500)
  try { await expect(badTools.connect()).rejects.toThrow() }
  finally { badTools.close() }
})

it("rejects a JSON-RPC response that does not match the pending numeric request id", async () => {
  const client = new McpStdioClient(process.execPath, [fixture, "bad-response-shape"], process.cwd(), process.env, 500)
  try { await expect(client.connect()).rejects.toThrow("timed out") }
  finally { client.close() }
})
