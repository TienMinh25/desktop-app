import { afterEach, expect, it } from "bun:test"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { editTool } from "../../../src/harness/tools/edit-tool"
import { createToolTestContext } from "./tool-test-context"

it("replaces one unique exact match", async () => {
  const testContext = await createToolTestContext()
  try {
    const path = join(testContext.context.workspacePath, "notes.txt")
    await writeFile(path, "before target after")
    const args = { path, oldText: "target", newText: "updated" }
    const prepared = await editTool.prepare!(args, testContext.context)
    expect(prepared.permissionRequests[0]?.tool).toBe("edit")
    await editTool.execute(args, testContext.context, prepared.data)
    expect(await readFile(path, "utf8")).toBe("before updated after")
  } finally { await testContext.cleanup() }
})

it("rejects a missing or ambiguous old-text match without changing the file", async () => {
  const testContext = await createToolTestContext()
  try {
    const path = join(testContext.context.workspacePath, "notes.txt")
    await writeFile(path, "same same")
    const args = { path, oldText: "same", newText: "new" }
    const prepared = await editTool.prepare!(args, testContext.context)
    await expect(editTool.execute(args, testContext.context, prepared.data)).rejects.toThrow("more than once")
    expect(await readFile(path, "utf8")).toBe("same same")
    const missing = { ...args, oldText: "absent" }
    const missingPrepared = await editTool.prepare!(missing, testContext.context)
    await expect(editTool.execute(missing, testContext.context, missingPrepared.data)).rejects.toThrow("not found")
  } finally { await testContext.cleanup() }
})
