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

it("rejects non-string content and writes text payloads larger than 1 MB", async () => {
  const testContext = await createToolTestContext()
  try {
    await expect(writeTool.prepare!({ path: "x", content: 1 }, testContext.context)).rejects.toThrow("content must be a string")
    const content = "x".repeat(1_000_001)
    const args = { path: "generated.data.txt", content }
    const prepared = await writeTool.prepare!(args, testContext.context)
    await writeTool.execute(args, testContext.context, prepared.data)
    expect((await readFile(join(testContext.context.workspacePath, args.path), "utf8")).length).toBe(content.length)
  } finally { await testContext.cleanup() }
})
