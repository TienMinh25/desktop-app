import { expect, it } from "bun:test"
import { readFile, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { applyPatchTool } from "../../../src/harness/tools/apply-patch-tool"
import { createToolTestContext } from "./tool-test-context"

it("validates and applies a unified diff within the selected workspace", async () => {
  const testContext = await createToolTestContext()
  try {
    const target = join(testContext.context.workspacePath, "hello.txt")
    await writeFile(target, "old\n")
    const patch = "diff --git a/hello.txt b/hello.txt\n--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-old\n+new\n"
    const prepared = await applyPatchTool.prepare!({ patch }, testContext.context)
    expect(prepared.permissionRequests[0]?.tool).toBe("apply_patch")
    await applyPatchTool.execute({ patch }, testContext.context, prepared.data)
    expect(await readFile(target, "utf8")).toBe("new\n")
  } finally { await testContext.cleanup() }
})

it("rejects patches with traversal paths before applying them", async () => {
  const testContext = await createToolTestContext()
  try {
    const patch = "--- a/../outside.txt\n+++ b/../outside.txt\n@@ -1 +1 @@\n-old\n+new\n"
    await expect(applyPatchTool.prepare!({ patch }, testContext.context)).rejects.toThrow("Patch path escapes workspace")
  } finally { await testContext.cleanup() }
})

it("applies new-file and delete-file patches without relying on a Git executable", async () => {
  const testContext = await createToolTestContext()
  try {
    const removedPath = join(testContext.context.workspacePath, "remove.txt")
    await writeFile(removedPath, "remove me\n")
    const patch = [
      "diff --git a/new.txt b/new.txt", "new file mode 100644", "--- /dev/null", "+++ b/new.txt", "@@ -0,0 +1 @@", "+created", "",
      "diff --git a/remove.txt b/remove.txt", "deleted file mode 100644", "--- a/remove.txt", "+++ /dev/null", "@@ -1 +0,0 @@", "-remove me", "",
    ].join("\n")
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
    const patch = "diff --git a/link.txt b/link.txt\n--- a/link.txt\n+++ b/link.txt\n@@ -1 +1 @@\n-old\n+new\n"
    await expect(testContext.context.environment.applyPatch(patch)).rejects.toThrow("symbolic link")
    expect(await readFile(target, "utf8")).toBe("old\n")
  } finally { await testContext.cleanup() }
})
