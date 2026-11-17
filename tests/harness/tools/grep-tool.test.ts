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

it("supports case-sensitive search when requested", async () => {
  const testContext = await createToolTestContext()
  try {
    await writeFile(join(testContext.context.workspacePath, "app.ts"), "Needle\nneedle\n")
    const args = { pattern: "needle", caseSensitive: true }
    const prepared = await grepTool.prepare!(args, testContext.context)
    expect(await grepTool.execute(args, testContext.context, prepared.data)).toBe("app.ts:2: needle")
  } finally { await testContext.cleanup() }
})

it("rejects overlong patterns and lets ripgrep validate regex syntax", async () => {
  const testContext = await createToolTestContext()
  try {
    await expect(grepTool.permissionRequests!({ pattern: "x".repeat(501) }, testContext.context)).rejects.toThrow("500 characters")
    await expect(grepTool.prepare!({ pattern: "needle", caseSensitive: "yes" }, testContext.context)).rejects.toThrow("caseSensitive must be a boolean")
    await expect(grepTool.prepare!({ pattern: "needle", glob: "a".repeat(1_001) }, testContext.context)).rejects.toThrow("1,000 characters")
    const unsafe = { pattern: "(a+)+$" }
    expect((await grepTool.prepare!(unsafe, testContext.context)).permissionRequests).toEqual([])
    await expect(grepTool.execute(unsafe, testContext.context, { files: [{ absolutePath: "app.ts", relativePath: "app.ts" }], truncated: false, visitedEntries: 1 })).rejects.toThrow()
  } finally { await testContext.cleanup() }
})

it("searches only the exact file set checked during sensitive-file preflight", async () => {
  const testContext = await createToolTestContext()
  try {
    await mkdir(join(testContext.context.workspacePath, ".ssh"))
    await writeFile(join(testContext.context.workspacePath, ".ssh", "id_ed25519"), "needle secret")
    await writeFile(join(testContext.context.workspacePath, "public.txt"), "needle public")
    const args = { pattern: "needle", glob: "**/.ssh/**" }
    const prepared = await grepTool.prepare!(args, testContext.context)
    expect(prepared.permissionRequests[0]).toMatchObject({ sensitive: true })
    expect(await grepTool.execute(args, testContext.context, prepared.data)).toBe(".ssh/id_ed25519:1: needle secret")
  } finally { await testContext.cleanup() }
})

it("requires workspace approval before expanding a truncated sensitive-file preflight", async () => {
  const testContext = await createToolTestContext()
  try {
    const workspace = testContext.context.environment.workspacePath
    testContext.context.environment.listFiles = async () => ({
      files: [{ absolutePath: join(workspace, "first.txt"), relativePath: "first.txt" }],
      visitedEntries: 2,
      truncated: true,
    })
    let searchedPaths: string[] | undefined = ["unexpected"]
    testContext.context.environment.searchText = async (_pattern, _glob, _limit, _caseSensitive, candidatePaths) => {
      searchedPaths = candidatePaths
      return { matches: [], truncated: false }
    }
    const args = { pattern: "needle" }
    const prepared = await grepTool.prepare!(args, testContext.context)
    expect(prepared.permissionRequests).toContainEqual(expect.objectContaining({ sensitive: true, resource: workspace }))
    await grepTool.execute(args, testContext.context, prepared.data)
    expect(searchedPaths).toBeUndefined()
  } finally { await testContext.cleanup() }
})

it("flags credential directories in search results for an additional permission check", async () => {
  const testContext = await createToolTestContext()
  try {
    const sshDirectory = join(testContext.context.workspacePath, ".ssh")
    await mkdir(sshDirectory)
    await writeFile(join(sshDirectory, "id_ed25519"), "private key")
    const prepared = await grepTool.prepare!({ pattern: "private", glob: "**/.ssh/**" }, testContext.context)
    expect(prepared.permissionRequests[0]).toMatchObject({ tool: "grep", sensitive: true })
  } finally { await testContext.cleanup() }
})
