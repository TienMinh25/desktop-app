import { afterEach, beforeEach, expect, it } from "bun:test"
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readTool } from "../../../src/harness/tools/read-tool"
import { createToolTestContext } from "./tool-test-context"

let testContext: Awaited<ReturnType<typeof createToolTestContext>>
let externalDirectory: string

beforeEach(async () => {
  testContext = await createToolTestContext()
  externalDirectory = await mkdtemp(join(tmpdir(), "outside-harness-"))
  await writeFile(join(testContext.context.workspacePath, "source.ts"), "export const inside = true")
  await writeFile(join(externalDirectory, ".env"), "TOKEN=test")
})

afterEach(async () => {
  await testContext.cleanup()
  await rm(externalDirectory, { recursive: true, force: true })
})

it("reads a workspace file and prepares an in-workspace permission requirement", async () => {
  const prepared = await readTool.prepare!({ path: "source.ts" }, testContext.context)
  expect(prepared.permissionRequests[0]?.outsideWorkspace).toBe(false)
  expect(await readTool.execute({ path: "source.ts" }, testContext.context, prepared.data))
    .toBe("Lines 1-1 of 1 (end of file)\nexport const inside = true")
})

it("rejects a workspace read if its parent directory is replaced by an external symlink", async () => {
  const workspaceDirectory = join(testContext.context.workspacePath, "src")
  const movedDirectory = join(testContext.context.workspacePath, "src-moved")
  const externalDirectory = await mkdtemp(join(tmpdir(), "swapped-read-"))
  await mkdir(workspaceDirectory)
  await writeFile(join(workspaceDirectory, "secret.txt"), "original workspace content")
  await writeFile(join(externalDirectory, "secret.txt"), "EXTERNAL SECRET")

  try {
    const prepared = await readTool.prepare!({ path: "src/secret.txt" }, testContext.context)
    await rename(workspaceDirectory, movedDirectory)
    await symlink(externalDirectory, workspaceDirectory, process.platform === "win32" ? "junction" : "dir")

    await expect(readTool.execute({ path: "src/secret.txt" }, testContext.context, prepared.data))
      .rejects.toThrow(/workspace|path|identity/i)
  } finally {
    await rm(externalDirectory, { recursive: true, force: true })
  }
})

it("marks external and dotenv reads as requiring extra approval", async () => {
  const prepared = await readTool.prepare!({ path: join(externalDirectory, ".env") }, testContext.context)
  expect(prepared.permissionRequests[0]).toMatchObject({ outsideWorkspace: true, sensitive: true, tool: "read" })
  expect(await readTool.execute({ path: join(externalDirectory, ".env") }, testContext.context, prepared.data)).toBe("TOKEN=test")
})

it("marks SSH private key paths as sensitive even inside the workspace", async () => {
  const sshDirectory = join(testContext.context.workspacePath, ".ssh")
  await mkdir(sshDirectory)
  await writeFile(join(sshDirectory, "id_ed25519"), "private")
  const prepared = await readTool.prepare!({ path: ".ssh/id_ed25519" }, testContext.context)
  expect(prepared.permissionRequests[0]).toMatchObject({ outsideWorkspace: false, sensitive: true })
})

it("rejects missing paths and files above the hard read limit", async () => {
  await expect(readTool.prepare!({ path: "missing.ts" }, testContext.context)).rejects.toThrow()
  await writeFile(join(testContext.context.workspacePath, "large.txt"), "x".repeat(20_000_001))
  const prepared = await readTool.prepare!({ path: "large.txt" }, testContext.context)
  await expect(readTool.execute({ path: "large.txt" }, testContext.context, prepared.data)).rejects.toThrow("20000000-byte limit")
})

it("returns one page and exposes the offset for the next read", async () => {
  await writeFile(join(testContext.context.workspacePath, "paged.txt"), "first\nsecond\nthird")
  const first = await readTool.prepare!({ path: "paged.txt", offset: 0, limit: 2 }, testContext.context)
  expect(await readTool.execute({ path: "paged.txt", offset: 0, limit: 2 }, testContext.context, first.data))
    .toBe("Lines 1-2 (next offset: 2)\nfirst\nsecond")
})
