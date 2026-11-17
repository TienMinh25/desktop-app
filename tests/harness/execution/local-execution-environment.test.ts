import { afterEach, beforeEach, expect, it } from "bun:test"
import { spawn } from "node:child_process"
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { LocalExecutionEnvironment } from "../../../src/harness/execution/local-execution-environment"

let root: string
let outsideFile: string
let environment: LocalExecutionEnvironment

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "harness-execution-")))
  outsideFile = join(dirname(root), `${root.split(/[\\/]/).pop()}-outside.txt`)
  await mkdir(join(root, "src"))
  await writeFile(join(root, "src", "index.ts"), "export const value = 1\n")
  await writeFile(outsideFile, "outside")
  environment = new LocalExecutionEnvironment(root)
})

afterEach(async () => {
  environment.close()
  await rm(root, { recursive: true, force: true })
  await rm(outsideFile, { force: true })
})

async function createProcessTreeCommand(): Promise<{ command: string; pidFile: string; readyFile: string }> {
  const pidFile = join(root, "child.pid")
  const readyFile = join(root, "child.ready")
  const scriptFile = join(root, "long-running.cjs")
  const childCode = `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(readyFile)}, 'ready'); setInterval(() => {}, 60000)`
  await writeFile(scriptFile, `const { spawn } = require("node:child_process")\nconst { writeFileSync } = require("node:fs")\nconst child = spawn(process.execPath, ["-e", ${JSON.stringify(childCode)}], { stdio: "ignore" })\nwriteFileSync(${JSON.stringify(pidFile)}, String(child.pid))\nsetInterval(() => {}, 60000)\n`)
  return { command: `node "${scriptFile}"`, pidFile, readyFile }
}

async function startProcessTree(timeoutMs = 120_000): Promise<{ commandPromise: Promise<import("../../../src/harness/execution/execution-environment").CommandResult>; childPid: number }> {
  const { command, pidFile, readyFile } = await createProcessTreeCommand()
  const commandPromise = environment.runCommand(command, timeoutMs)
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      const childPid = Number(await readFile(pidFile, "utf8"))
      if (Number.isInteger(childPid) && childPid > 0) {
        await readFile(readyFile, "utf8")
        return { commandPromise, childPid }
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  environment.close()
  await commandPromise
  throw new Error("The command did not start its child process")
}

async function expectProcessExited(pid: number): Promise<void> {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    try { process.kill(pid, 0) }
    catch { return }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Process ${pid} is still running`)
}

async function forceKillTestProcess(pid: number): Promise<void> {
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
    await new Promise<void>((resolve) => {
      killer.once("close", () => resolve())
      killer.once("error", () => resolve())
    })
    return
  }
  try { process.kill(pid, "SIGKILL") } catch {}
}

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

it("terminates the entire process tree when a command times out", async () => {
  const { commandPromise, childPid } = await startProcessTree(1_000)
  try {
    const result = await commandPromise
    expect(result.timedOut).toBe(true)
    await expectProcessExited(childPid)
  } finally {
    await forceKillTestProcess(childPid)
  }
})

it("terminates running process trees when the environment closes", async () => {
  const { commandPromise, childPid } = await startProcessTree()
  try {
    environment.close()
    environment.close()
    const result = await Promise.race([commandPromise, new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000))])
    expect(result).not.toBeNull()
    await expectProcessExited(childPid)
  } finally {
    await forceKillTestProcess(childPid)
  }
})

it("rejects commands after the environment closes", async () => {
  environment.close()
  await expect(environment.runCommand("echo must-not-run")).rejects.toThrow("Execution environment is closed")
})

it("does not report a normal command as timed out", async () => {
  const result = await environment.runCommand("printf shell-ok", 1_000)
  expect(result.stdout).toBe("shell-ok")
  expect(result.timedOut).toBe(false)
})

it("keeps the host alive until a stubborn POSIX descendant is force-killed", async () => {
  if (process.platform === "win32") return
  const { command, pidFile, readyFile } = await createProcessTreeCommand()
  const moduleUrl = pathToFileURL(join(process.cwd(), "src/harness/execution/local-execution-environment.ts")).href
  const runnerSource = `import { LocalExecutionEnvironment } from ${JSON.stringify(moduleUrl)}\nconst environment = new LocalExecutionEnvironment(${JSON.stringify(root)})\nawait environment.runCommand(${JSON.stringify(command)}, 1000)\n`
  const runner = spawn(process.execPath, ["-e", runnerSource], { stdio: "ignore" })
  let pid: number | undefined
  try {
    const exitCode = await new Promise<number | null>((resolve) => runner.once("close", resolve))
    expect(exitCode).toBe(0)
    pid = Number(await readFile(pidFile, "utf8"))
    await readFile(readyFile, "utf8")
    await expectProcessExited(pid)
  } finally {
    if (pid) { try { process.kill(pid, "SIGKILL") } catch {} }
  }
})

it("rejects patch paths that escape the workspace", () => {
  expect(() => environment.validatePatch("--- a/../outside.txt\n+++ b/../outside.txt\n@@ -1 +1 @@\n-x\n+y\n")).toThrow("Patch path escapes workspace")
  expect(environment.validatePatch("--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-x\n+y\n")).toEqual(["src/index.ts"])
})
