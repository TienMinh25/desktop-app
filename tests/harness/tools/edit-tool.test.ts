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
    const args = { path, oldString: "target", newString: "updated" }
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
    const args = { path, oldString: "same", newString: "new" }
    const prepared = await editTool.prepare!(args, testContext.context)
    await expect(editTool.execute(args, testContext.context, prepared.data)).rejects.toThrow("more than once")
    expect(await readFile(path, "utf8")).toBe("same same")
    const missing = { ...args, oldString: "absent" }
    const missingPrepared = await editTool.prepare!(missing, testContext.context)
    await expect(editTool.execute(missing, testContext.context, missingPrepared.data)).rejects.toThrow("not found")
  } finally { await testContext.cleanup() }
})

it("counts overlapping oldString matches as ambiguous", async () => {
  const testContext = await createToolTestContext()
  try {
    const path = join(testContext.context.workspacePath, "overlap.txt")
    await writeFile(path, "aaa")
    const args = { path, oldString: "aa", newString: "x" }
    const prepared = await editTool.prepare!(args, testContext.context)
    await expect(editTool.execute(args, testContext.context, prepared.data)).rejects.toThrow("matched more than once")
    expect(await readFile(path, "utf8")).toBe("aaa")
  } finally { await testContext.cleanup() }
})

it("supports replaceAll and edits files larger than 1 MB", async () => {
  const testContext = await createToolTestContext()
  try {
    const path = join(testContext.context.workspacePath, "large.ts")
    const original = `${"x".repeat(1_000_010)} target target`
    await writeFile(path, original)
    const args = { path, oldString: "target", newString: "updated", replaceAll: true }
    const prepared = await editTool.prepare!(args, testContext.context)
    await editTool.execute(args, testContext.context, prepared.data)
    expect(await readFile(path, "utf8")).toBe(`${"x".repeat(1_000_010)} updated updated`)
  } finally { await testContext.cleanup() }
})

it("rejects empty oldString and no-op replacements", async () => {
  const testContext = await createToolTestContext()
  try {
    const path = join(testContext.context.workspacePath, "notes.txt")
    await writeFile(path, "same")
    await expect(editTool.prepare!({ path, oldString: "", newString: "x" }, testContext.context)).rejects.toThrow("oldString must not be empty")
    const args = { path, oldString: "same", newString: "same" }
    const prepared = await editTool.prepare!(args, testContext.context)
    await expect(editTool.execute(args, testContext.context, prepared.data)).rejects.toThrow("no changes")
  } finally { await testContext.cleanup() }
})
