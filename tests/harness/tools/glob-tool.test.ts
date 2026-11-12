import { expect, it } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { globTool } from "../../../src/harness/tools/glob-tool"
import { createToolTestContext } from "./tool-test-context"

it("lists only workspace-relative paths matching the requested pattern", async () => {
  const testContext = await createToolTestContext()
  try {
    await mkdir(join(testContext.context.workspacePath, "src"))
    await writeFile(join(testContext.context.workspacePath, "src", "main.ts"), "export {}")
    await writeFile(join(testContext.context.workspacePath, "readme.md"), "readme")
    const result = await globTool.execute({ pattern: "**/*.ts" }, testContext.context)
    expect(result).toBe("src/main.ts")
  } finally { await testContext.cleanup() }
})

it("includes non-empty matching directories as well as files", async () => {
  const testContext = await createToolTestContext()
  try {
    await mkdir(join(testContext.context.workspacePath, "src", "nested"), { recursive: true })
    await writeFile(join(testContext.context.workspacePath, "src", "nested", "main.ts"), "export {}")
    const result = await globTool.execute({ pattern: "**/*" }, testContext.context)
    expect(result).toContain("src\n")
    expect(result).toContain("src/nested")
    expect(result).toContain("src/nested/main.ts")
  } finally { await testContext.cleanup() }
})

it("rejects malformed glob patterns during preparation", async () => {
  const testContext = await createToolTestContext()
  try {
    await expect(globTool.prepare!({ pattern: "../outside" }, testContext.context)).rejects.toThrow("stay inside")
  } finally { await testContext.cleanup() }
})
