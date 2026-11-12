import { afterEach, expect, it } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { grepTool } from "../../../src/harness/tools/grep-tool"
import { createToolTestContext } from "./tool-test-context"

it("returns workspace-relative matching lines and records search permission", async () => {
  const testContext = await createToolTestContext()
  try {
    await writeFile(join(testContext.context.workspacePath, "app.ts"), "first\nneedle value\nlast\n")
    const args = { pattern: "needle" }
    const permission = await grepTool.permissionRequests!(args, testContext.context)
    const prepared = await grepTool.prepare!(args, testContext.context)
    expect(permission[0]?.tool).toBe("grep")
    expect(await grepTool.execute(args, testContext.context, prepared.data)).toBe("app.ts:2: needle value")
  } finally { await testContext.cleanup() }
})

it("rejects invalid, overlong, and unsafe nested regex patterns", async () => {
  const testContext = await createToolTestContext()
  try {
    await expect(grepTool.permissionRequests!({ pattern: "[" }, testContext.context)).rejects.toThrow()
    await expect(grepTool.permissionRequests!({ pattern: "x".repeat(501) }, testContext.context)).rejects.toThrow("500 characters")
    const unsafe = { pattern: "(a+)+$" }
    await expect(grepTool.prepare!(unsafe, testContext.context)).rejects.toThrow("Nested or repeated regex groups")
  } finally { await testContext.cleanup() }
})

it("flags credential directories in search results for an additional permission check", async () => {
  const testContext = await createToolTestContext()
  try {
    const sshDirectory = join(testContext.context.workspacePath, ".ssh")
    await mkdir(sshDirectory)
    await writeFile(join(sshDirectory, "id_ed25519"), "private key")
    const prepared = await grepTool.prepare!({ pattern: "private" }, testContext.context)
    expect(prepared.permissionRequests[0]).toMatchObject({ tool: "grep", sensitive: true })
  } finally { await testContext.cleanup() }
})
