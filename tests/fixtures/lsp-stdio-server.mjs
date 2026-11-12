let input = Buffer.alloc(0)

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8")
  process.stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]))
}

process.stdin.on("data", (chunk) => {
  input = Buffer.concat([input, chunk])
  for (;;) {
    const separator = input.indexOf("\r\n\r\n")
    if (separator < 0) return
    const headers = input.subarray(0, separator).toString("ascii")
    const length = Number(headers.match(/Content-Length:\s*(\d+)/i)?.[1])
    if (!Number.isInteger(length) || input.length < separator + 4 + length) return
    const body = input.subarray(separator + 4, separator + 4 + length).toString("utf8")
    input = input.subarray(separator + 4 + length)
    const message = JSON.parse(body)
    if (process.argv[2] === "bad-frame") {
      process.stdout.write("invalid frame\r\n\r\n")
      continue
    }
    if (message.method === "textDocument/didOpen") {
      send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri: message.params.textDocument.uri, diagnostics: [{ message: "fixture diagnostic", severity: 2 }] } })
    } else if (Number.isInteger(message.id)) {
      let result = null
      if (message.method === "initialize") result = { capabilities: {} }
      else if (message.method === "textDocument/hover") result = { contents: { kind: "plaintext", value: "fixture hover" } }
      else if (message.method === "textDocument/definition") result = [{ uri: message.params.textDocument.uri }]
      else if (message.method === "textDocument/references") result = []
      send({ jsonrpc: "2.0", id: message.id, result })
    }
  }
})
