import { afterEach, beforeEach, expect, it } from "bun:test"
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { LocalExecutionEnvironment } from "../../../src/harness/execution/local-execution-environment"

let root: string
let outsideFile: string
let environment: LocalExecutionEnvironment

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "harness-execution-"))
  outsideFile = join(dirname(root), `${root.split(/[\\/]/).pop()}-outside.txt`)
  await mkdir(join(root, "src"))
  await writeFile(join(root, "src", "index.ts"), "export const value = 1\n")
  await writeFile(outsideFile, "outside")
  environment = new LocalExecutionEnvironment(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outsideFile, { force: true })
})

it("resolves relative paths inside the workspace and flags paths outside it", async () => {
  const canonicalRoot = await realpath(root)
  expect(await environment.resolvePath("src/index.ts")).toEqual({ path: join(canonicalRoot, "src", "index.ts"), insideWorkspace: true })
  const outside = await environment.resolvePath(outsideFile)
  expect(outside.path).toBe(await realpath(outsideFile))
  expect(outside.insideWorkspace).toBe(false)
})

it("lists matching paths with ripgrep and caps file results", async () => {
  await mkdir(join(root, "src", "nested"))
  await writeFile(join(root, "src", "nested", "extra.ts"), "export {}")
  const result = await environment.listFiles("**/*.ts", 1)
  expect(result.files).toHaveLength(1)
  expect(result.files[0]?.relativePath).toMatch(/^src\//)
  expect(result.truncated).toBe(true)
})

it("searches text with ripgrep and returns workspace-relative matches", async () => {
  await writeFile(join(root, "src", "index.ts"), "first\nneedle value\nlast\n")
  const result = await environment.searchText("needle", "**/*.ts", 10)
  expect(result.matches).toEqual(["src/index.ts:2:needle value"])
  expect(result.truncated).toBe(false)
})

it("creates missing parent directories for write targets", async () => {
  const target = await environment.resolvePath("new-file.txt", true)
  expect(target).toEqual({ path: join(await realpath(root), "new-file.txt"), insideWorkspace: true })
  await environment.writeTextFile(target.path, "generated")
  expect(await readFile(target.path, "utf8")).toBe("generated")
  const nestedTarget = await environment.resolvePath("missing/new-file.txt", true)
  await environment.writeTextFile(nestedTarget.path, "nested generated")
  expect(await readFile(nestedTarget.path, "utf8")).toBe("nested generated")
})

it("reads files in line pages with a continuation offset", async () => {
  await writeFile(join(root, "pages.txt"), "one\ntwo\nthree\n")
  const first = await environment.readTextFilePage(join(root, "pages.txt"), true, 0, 2)
  expect(first).toEqual({ content: "one\ntwo", startLine: 1, endLine: 2, nextOffset: 2 })
  const second = await environment.readTextFilePage(join(root, "pages.txt"), true, first.nextOffset!, 2)
  expect(second).toEqual({ content: "three", startLine: 3, endLine: 3, totalLines: 3 })
})

it("rejects oversized and binary reads", async () => {
  await expect(environment.readTextFile(join(root, "src", "index.ts"), 2, true)).rejects.toThrow("File exceeds the 2-byte limit")
  const binaryFile = join(root, "binary.bin")
  await writeFile(binaryFile, Buffer.from([0, 1, 2]))
  await expect(environment.readTextFile(binaryFile, 100, true)).rejects.toThrow("Binary files are not supported")
})

it("does not follow a symlink when writing a file", async () => {
  const link = join(root, "outside-link.txt")
  await symlink(outsideFile, link)
  await expect(environment.writeTextFile(link, "changed")).rejects.toThrow("Refusing to write through a symbolic link")
  expect(await readFile(outsideFile, "utf8")).toBe("outside")
})

it("rejects patch paths that escape the workspace", () => {
  expect(() => environment.validatePatch("--- a/../outside.txt\n+++ b/../outside.txt\n@@ -1 +1 @@\n-x\n+y\n")).toThrow("Patch path escapes workspace")
  expect(environment.validatePatch("--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-x\n+y\n")).toEqual(["src/index.ts"])
})
