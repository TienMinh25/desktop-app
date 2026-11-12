import { expect, it } from "bun:test"
import { resolve } from "node:path"
import { LspManager } from "../../../src/harness/lsp/lsp-manager"
import { createToolTestContext } from "../tools/tool-test-context"

const fixture = resolve(import.meta.dir, "../../fixtures/lsp-stdio-server.mjs")

it("starts a language server, routes a typed operation, and returns diagnostics", async () => {
  const testContext = await createToolTestContext()
  const manager = new LspManager(JSON.stringify([{ extensions: ["ts"], command: process.execPath, args: [fixture] }]))
  try {
    const hover = await manager.execute("hover", `${testContext.context.workspacePath}/main.ts`, testContext.context.workspacePath, "const answer = 42", 1, 7)
    expect(JSON.parse(hover)).toEqual({ contents: { kind: "plaintext", value: "fixture hover" } })
    const diagnostics = await manager.execute("diagnostics", `${testContext.context.workspacePath}/main.ts`, testContext.context.workspacePath, "const answer = 42")
    expect(JSON.parse(diagnostics)).toEqual([{ message: "fixture diagnostic", severity: 2 }])
  } finally {
    manager.close()
    await testContext.cleanup()
  }
})

it("rejects missing or malformed language-server configuration", async () => {
  const missing = new LspManager(undefined)
  await expect(missing.execute("hover", "/tmp/file.ts", "/tmp", "text")).rejects.toThrow("No language server configured")
  const malformed = new LspManager("not json")
  await expect(malformed.execute("hover", "/tmp/file.ts", "/tmp", "text")).rejects.toThrow()
  const invalidCwd = new LspManager(JSON.stringify([{ extensions: ["ts"], command: process.execPath, cwd: 5 }]))
  await expect(invalidCwd.execute("hover", "/tmp/file.ts", "/tmp", "text")).rejects.toThrow("cwd must be a string")
})
