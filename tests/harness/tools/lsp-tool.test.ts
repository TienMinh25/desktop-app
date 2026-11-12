import { expect, it } from "bun:test"
import { realpath, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { LspManager } from "../../../src/harness/lsp/lsp-manager"
import { createLspTool } from "../../../src/harness/tools/lsp-tool"
import { createToolTestContext } from "./tool-test-context"

it("validates a source query, reads the file, and forwards the typed request", async () => {
  const testContext = await createToolTestContext()
  try {
    const path = join(testContext.context.workspacePath, "main.ts")
    await writeFile(path, "const answer = 42")
    const calls: unknown[] = []
    const manager = { execute: async (...args: unknown[]) => { calls.push(args); return "hover result" } } as unknown as LspManager
    const tool = createLspTool(manager)
    const args = { operation: "hover", path: "main.ts", line: 1, character: 7 }
    const prepared = await tool.prepare!(args, testContext.context)
    expect(prepared.permissionRequests[0]?.tool).toBe("lsp")
    expect(await tool.execute(args, testContext.context, prepared.data)).toBe("hover result")
    expect(calls[0]).toEqual(["hover", await realpath(path), testContext.context.workspacePath, "const answer = 42", 1, 7])
  } finally { await testContext.cleanup() }
})

it("rejects unsupported LSP operations and non-positive positions", async () => {
  const testContext = await createToolTestContext()
  try {
    const tool = createLspTool({} as LspManager)
    await expect(tool.prepare!({ operation: "rename", path: "main.ts" }, testContext.context)).rejects.toThrow("Unsupported LSP operation")
    await writeFile(join(testContext.context.workspacePath, "main.ts"), "const x = 1")
    await expect(tool.prepare!({ operation: "hover", path: "main.ts", line: 0 }, testContext.context)).rejects.toThrow("positive integers")
  } finally { await testContext.cleanup() }
})
