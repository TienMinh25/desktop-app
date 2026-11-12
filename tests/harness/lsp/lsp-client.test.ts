import { expect, it } from "bun:test"
import { resolve } from "node:path"
import { LspClient } from "../../../src/harness/lsp/lsp-client"

const fixture = resolve(import.meta.dir, "../../fixtures/lsp-stdio-server.mjs")

it("opens documents and queries hover, definition, and references over framed stdio", async () => {
  const client = new LspClient(process.execPath, [fixture], process.cwd(), process.env)
  try {
    const file = resolve("src/example.ts")
    const uri = await client.open(process.cwd(), file, "typescript", "const answer = 42")
    expect(uri).toContain("file:")
    const [hover, definition, references] = await Promise.all([
      client.query("hover", uri, 1, 7),
      client.query("definition", uri, 1, 7),
      client.query("references", uri, 1, 7),
    ])
    expect(hover).toMatchObject({ contents: { value: "fixture hover" } })
    expect(definition).toEqual([{ uri }])
    expect(references).toEqual([])
    expect(await client.getDiagnostics(uri)).toEqual([{ message: "fixture diagnostic", severity: 2 }])
  } finally { client.close() }
})

it("rejects pending initialization when the language server sends an invalid frame", async () => {
  const client = new LspClient(process.execPath, [fixture, "bad-frame"], process.cwd(), process.env)
  await expect(client.open(process.cwd(), resolve("src/example.ts"), "typescript", "text")).rejects.toThrow("Invalid LSP frame")
  client.close()
})
