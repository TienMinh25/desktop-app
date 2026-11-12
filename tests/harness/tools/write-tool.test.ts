import { afterEach, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { writeTool } from "../../../src/harness/tools/write-tool"
import { createToolTestContext } from "./tool-test-context"

it("writes generated content inside the effective workspace after reporting permission intent", async () => {
  const testContext = await createToolTestContext()
  try {
    const prepared = await writeTool.prepare!({ path: "generated.ts", content: "export {}" }, testContext.context)
    expect(prepared.permissionRequests[0]).toMatchObject({ tool: "write", outsideWorkspace: false })
    expect(await writeTool.execute({ path: "generated.ts", content: "export {}" }, testContext.context, prepared.data)).toContain("generated.ts")
    expect(await readFile(join(testContext.context.workspacePath, "generated.ts"), "utf8")).toBe("export {}")
  } finally { await testContext.cleanup() }
})

it("rejects non-string content and over-limit payloads before writing", async () => {
  const testContext = await createToolTestContext()
  try {
    await expect(writeTool.prepare!({ path: "x", content: 1 }, testContext.context)).rejects.toThrow("content must be a string")
    await expect(writeTool.prepare!({ path: "x", content: "x".repeat(1_000_001) }, testContext.context)).rejects.toThrow("1 MB limit")
  } finally { await testContext.cleanup() }
})
