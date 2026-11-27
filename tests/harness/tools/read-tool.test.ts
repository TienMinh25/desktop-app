import { afterEach, beforeEach, expect, it, spyOn } from "bun:test"
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
  expect(await readTool.execute({ path: join(externalDirectory, ".env") }, testContext.context, prepared.data)).toBe("Lines 1-1 of 1 (end of file)\nTOKEN=test")
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

it("reads csv files through the UTF-8 text path", async () => {
  await writeFile(join(testContext.context.workspacePath, "data.csv"), "a,b\n1,2\n3,4")
  const prepared = await readTool.prepare!({ path: "data.csv", offset: 0, limit: 2 }, testContext.context)
  expect(await readTool.execute({ path: "data.csv", offset: 0, limit: 2 }, testContext.context, prepared.data))
    .toBe("Lines 1-2 (next offset: 2)\na,b\n1,2")
  const next = { path: "data.csv", offset: 2, limit: 2 }
  const second = await readTool.prepare!(next, testContext.context)
  expect(await readTool.execute(next, testContext.context, second.data)).toBe("Lines 3-3 of 3 (end of file)\n3,4")
})

it("refuses Office files with a text message without reading bytes", async () => {
  const bytes = spyOn(testContext.context.environment, "readFileBytes")
  const textPage = spyOn(testContext.context.environment, "readTextFilePage")

  for (const ext of [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"]) {
    const filename = `report${ext}`
    await writeFile(join(testContext.context.workspacePath, filename), "placeholder")
    const prepared = await readTool.prepare!({ path: filename }, testContext.context)
    const result = await readTool.execute({ path: filename }, { ...testContext.context, mediaInput: true }, prepared.data)
    expect(result).toBe(`Reading ${ext} files is not supported yet. Convert the file to PDF or text first.`)
  }
  expect(bytes).not.toHaveBeenCalled()
  expect(textPage).not.toHaveBeenCalled()
})

it("refuses images and PDFs without reading bytes when mediaInput is false", async () => {
  const bytes = spyOn(testContext.context.environment, "readFileBytes")
  const textPage = spyOn(testContext.context.environment, "readTextFilePage")

  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
  const pdfBytes = Buffer.from("%PDF-1.7\n")
  await writeFile(join(testContext.context.workspacePath, "chart.png"), pngBytes)
  await writeFile(join(testContext.context.workspacePath, "doc.pdf"), pdfBytes)

  const pngPrepared = await readTool.prepare!({ path: "chart.png" }, testContext.context)
  expect(await readTool.execute({ path: "chart.png" }, { ...testContext.context, mediaInput: false }, pngPrepared.data))
    .toBe("The current model does not support reading PNG image files.")

  const pdfPrepared = await readTool.prepare!({ path: "doc.pdf" }, testContext.context)
  expect(await readTool.execute({ path: "doc.pdf" }, { ...testContext.context, mediaInput: false }, pdfPrepared.data))
    .toBe("The current model does not support reading PDF document files.")

  expect(bytes).not.toHaveBeenCalled()
  expect(textPage).not.toHaveBeenCalled()
})

it("returns image and PDF data URLs when mediaInput is true", async () => {
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
  const pdfBytes = Buffer.from("%PDF-1.7\n")
  await writeFile(join(testContext.context.workspacePath, "chart.png"), pngBytes)
  await writeFile(join(testContext.context.workspacePath, "doc.pdf"), pdfBytes)

  const mediaContext = { ...testContext.context, mediaInput: true }
  const pngPrepared = await readTool.prepare!({ path: "chart.png" }, mediaContext)
  expect(await readTool.execute({ path: "chart.png" }, mediaContext, pngPrepared.data)).toEqual([
    { type: "input_text", text: "Read file: chart.png (PNG image)." },
    { type: "input_image", image_url: `data:image/png;base64,${pngBytes.toString("base64")}`, detail: "auto" },
  ])

  const pdfPrepared = await readTool.prepare!({ path: "doc.pdf" }, mediaContext)
  expect(await readTool.execute({ path: "doc.pdf" }, mediaContext, pdfPrepared.data)).toEqual([
    { type: "input_text", text: "Read file: doc.pdf (PDF document)." },
    { type: "input_file", filename: "doc.pdf", file_data: `data:application/pdf;base64,${pdfBytes.toString("base64")}` },
  ])
})
