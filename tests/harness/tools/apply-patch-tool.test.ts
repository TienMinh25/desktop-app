import { expect, it } from "bun:test"
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { applyPatchTool } from "../../../src/harness/tools/apply-patch-tool"
import { createToolTestContext } from "./tool-test-context"

it("validates and applies OpenCode update patches within the selected workspace", async () => {
  const testContext = await createToolTestContext()
  try {
    const target = join(testContext.context.workspacePath, "hello.txt")
    await writeFile(target, "old\n")
    const patchText = "*** Begin Patch\n*** Update File: hello.txt\n@@\n-old\n+new\n*** End Patch"
    const prepared = await applyPatchTool.prepare!({ patchText }, testContext.context)
    expect(prepared.permissionRequests[0]?.tool).toBe("apply_patch")
    await applyPatchTool.execute({ patchText }, testContext.context, prepared.data)
    expect(await readFile(target, "utf8")).toBe("new\n")
  } finally { await testContext.cleanup() }
})

it("rejects patches with traversal paths before applying them", async () => {
  const testContext = await createToolTestContext()
  try {
    const patchText = "*** Begin Patch\n*** Update File: ../outside.txt\n@@\n-old\n+new\n*** End Patch"
    await expect(applyPatchTool.prepare!({ patchText }, testContext.context)).rejects.toThrow("Patch path escapes workspace")
  } finally { await testContext.cleanup() }
})

it("applies add and delete operations in one patch without relying on a Git executable", async () => {
  const testContext = await createToolTestContext()
  try {
    const removedPath = join(testContext.context.workspacePath, "remove.txt")
    await writeFile(removedPath, "remove me\n")
    const patch = ["*** Begin Patch", "*** Add File: new.txt", "+created", "*** Delete File: remove.txt", "*** End Patch"].join("\n")
    const originalPath = process.env.PATH
    process.env.PATH = ""
    try { await testContext.context.environment.applyPatch(patch) }
    finally { process.env.PATH = originalPath }
    expect(await readFile(join(testContext.context.workspacePath, "new.txt"), "utf8")).toBe("created\n")
    await expect(readFile(removedPath, "utf8")).rejects.toThrow()
  } finally { await testContext.cleanup() }
})

it("rejects patch targets that are symbolic links", async () => {
  const testContext = await createToolTestContext()
  try {
    const target = join(testContext.context.workspacePath, "real.txt")
    await writeFile(target, "old\n")
    await symlink(target, join(testContext.context.workspacePath, "link.txt"))
    const patch = "*** Begin Patch\n*** Update File: link.txt\n@@\n-old\n+new\n*** End Patch"
    await expect(testContext.context.environment.applyPatch(patch)).rejects.toThrow("symbolic link")
    expect(await readFile(target, "utf8")).toBe("old\n")
  } finally { await testContext.cleanup() }
})

it("rejects a patch path resolving outside the workspace before approval", async () => {
  const testContext = await createToolTestContext()
  const outsideRoot = await mkdtemp(join(tmpdir(), "harness-patch-outside-"))
  try {
    const outside = join(outsideRoot, "outside.txt")
    await writeFile(outside, "old\n")
    await symlink(outside, join(testContext.context.workspacePath, "link.txt"))
    const patchText = "*** Begin Patch\n*** Update File: link.txt\n@@\n-old\n+new\n*** End Patch"
    await expect(applyPatchTool.prepare!({ patchText }, testContext.context)).rejects.toThrow("Patch path escapes workspace")
  } finally { await Promise.all([testContext.cleanup(), rm(outsideRoot, { recursive: true, force: true })]) }
})

it("moves a file and applies multi-line context edits", async () => {
  const testContext = await createToolTestContext()
  try {
    await writeFile(join(testContext.context.workspacePath, "before.txt"), "first\nkeep\nlast\n")
    const patchText = [
      "*** Begin Patch",
      "*** Update File: before.txt",
      "*** Move to: nested/after.md",
      "@@",
      " first",
      " keep",
      "-last",
      "+changed",
      "*** End Patch",
    ].join("\n")
    const prepared = await applyPatchTool.prepare!({ patchText }, testContext.context)
    await applyPatchTool.execute({ patchText }, testContext.context, prepared.data)
    expect(await readFile(join(testContext.context.workspacePath, "nested/after.md"), "utf8")).toBe("first\nkeep\nchanged\n")
    await expect(readFile(join(testContext.context.workspacePath, "before.txt"), "utf8")).rejects.toThrow()
  } finally { await testContext.cleanup() }
})

it("uses an end-of-file anchor to update the final matching hunk", async () => {
  const testContext = await createToolTestContext()
  try {
    const path = join(testContext.context.workspacePath, "repeated.txt")
    await writeFile(path, "marker\nend\nmiddle\nmarker\nend")
    const patchText = [
      "*** Begin Patch",
      "*** Update File: repeated.txt",
      "@@",
      "-marker",
      "-end",
      "+marker-changed",
      "+end",
      "*** End of File",
      "*** End Patch",
    ].join("\n")
    await testContext.context.environment.applyPatch(patchText)
    expect(await readFile(path, "utf8")).toBe("marker\nend\nmiddle\nmarker-changed\nend")
  } finally { await testContext.cleanup() }
})

it("accepts patch text larger than 1 MB", async () => {
  const testContext = await createToolTestContext()
  try {
    const path = join(testContext.context.workspacePath, "large.txt")
    const oldText = "x".repeat(1_000_010)
    await writeFile(path, oldText)
    const patchText = `*** Begin Patch\n*** Update File: large.txt\n@@\n-${oldText}\n+changed\n*** End Patch`
    const prepared = await applyPatchTool.prepare!({ patchText }, testContext.context)
    await applyPatchTool.execute({ patchText }, testContext.context, prepared.data)
    expect(await readFile(path, "utf8")).toBe("changed")
  } finally { await testContext.cleanup() }
})
