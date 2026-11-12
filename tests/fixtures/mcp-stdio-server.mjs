import { createInterface } from "node:readline"

const mode = process.argv[2] ?? "normal"
const input = createInterface({ input: process.stdin })

input.on("line", (line) => {
  const message = JSON.parse(line)
  if (mode === "bad-json") {
    process.stdout.write("not json\n")
    return
  }
  if (mode === "bad-response-shape") {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: "wrong", result: {} })}\n`)
    return
  }
  if (!Number.isInteger(message.id)) return
  let result
  if (message.method === "initialize") {
    result = mode === "bad-initialize" ? "malformed" : {
      protocolVersion: mode === "bad-version" ? "unknown" : "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: { name: "fixture", version: "1.0.0" },
    }
  } else if (message.method === "tools/list") {
    result = mode === "bad-tools" ? { tools: "not-an-array" } : { tools: [{ name: "echo", description: "Echo text", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }] }
  } else if (message.method === "tools/call") {
    result = message.params.arguments.fail
      ? { isError: true, content: [{ type: "text", text: "server rejected call" }] }
      : { content: [{ type: "text", text: `echo:${message.params.arguments.text}` }] }
  } else {
    result = {}
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`)
})
