import { expect, it } from "bun:test"
import { resolve } from "node:path"
import { LspManager } from "../../../src/harness/lsp/lsp-manager"
import type { LspServerConfig } from "../../../src/contracts/lsp"
import { createToolTestContext } from "../tools/tool-test-context"

const fixture = resolve(import.meta.dir, "../../fixtures/lsp-stdio-server.mjs")

it("starts a language server, routes a typed operation, and returns diagnostics", async () => {
  const testContext = await createToolTestContext()
  const manager = new LspManager()
  manager.setConfiguration([{ extensions: ["ts"], command: process.execPath, args: [fixture] }])
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
  const missing = new LspManager()
  await expect(missing.execute("hover", "/tmp/file.ts", "/tmp", "text")).rejects.toThrow("No enabled language server supports")
  const malformed = new LspManager()
  expect(() => malformed.setConfiguration("not json" as unknown as LspServerConfig[])).toThrow()
  const invalidCwd = new LspManager()
  expect(() => invalidCwd.setConfiguration([{ extensions: ["ts"], command: process.execPath, cwd: 5 }] as unknown as LspServerConfig[])).toThrow("cwd must be a string")
})
