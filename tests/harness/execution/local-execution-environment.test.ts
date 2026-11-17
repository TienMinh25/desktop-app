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

it("respects ignore rules and omits hidden files from broad listings", async () => {
  await writeFile(join(root, ".gitignore"), "ignored/\n")
  await mkdir(join(root, "ignored"))
  await writeFile(join(root, "ignored", "secret.ts"), "needle")
  await mkdir(join(root, ".hidden"))
  await writeFile(join(root, ".hidden", "config.ts"), "needle")

  const files = await environment.listFiles("**/*", 100)
  const matches = await environment.searchText("needle", "**/*", 100)

  expect(files.files.map((file) => file.relativePath)).not.toContain("ignored/secret.ts")
  expect(files.files.map((file) => file.relativePath)).not.toContain(".hidden/config.ts")
  expect(matches.matches).toEqual([])
})

it("allows an explicit glob to include a hidden path while honoring ignore rules", async () => {
  await mkdir(join(root, ".hidden"))
  await writeFile(join(root, ".hidden", "config.ts"), "export {}")

  const result = await environment.listFiles(".hidden/**/*.ts", 100)

  expect(result.files.map((file) => file.relativePath)).toEqual([".hidden/config.ts"])
})

it("allows a brace glob that explicitly names a hidden directory", async () => {
  await mkdir(join(root, ".hidden"))
  await writeFile(join(root, ".hidden", "config.ts"), "hidden")
  await writeFile(join(root, "src", "config.ts"), "visible")

  const result = await environment.listFiles("**/{.hidden,src}/**/*.ts", 100)

  expect(result.files.map((file) => file.relativePath)).toContain(".hidden/config.ts")
  expect(result.files.map((file) => file.relativePath)).toContain("src/config.ts")
})

it("uses ripgrep brace and character-class glob syntax consistently", async () => {
  await writeFile(join(root, "src", "main.tsx"), "export {}")
  await writeFile(join(root, "src", "main.test.ts"), "export {}")
  await writeFile(join(root, "src", "main.test.tsx"), "export {}")

  const braces = await environment.listFiles("src/**/*.{ts,tsx}", 100)
  const characterClass = await environment.listFiles("src/**/*.[t]s", 100)

  expect(braces.files.map((file) => file.relativePath)).toContain("src/main.tsx")
  expect(braces.files.map((file) => file.relativePath)).toContain("src/main.test.ts")
  expect(characterClass.files.map((file) => file.relativePath)).toContain("src/main.test.ts")
})

it("reports malformed ripgrep glob syntax instead of silently returning no matches", async () => {
  await expect(environment.listFiles("src/**/*.{ts,", 100)).rejects.toThrow()
})

it("searches text case-insensitively by default and supports a case-sensitive override", async () => {
  await writeFile(join(root, "src", "index.ts"), "Needle\nneedle\n")

  const insensitive = await environment.searchText("needle", "**/*.ts", 10)
  const sensitive = await environment.searchText("needle", "**/*.ts", 10, true)

  expect(insensitive.matches.map((match) => match.line)).toEqual([1, 2])
  expect(sensitive.matches.map((match) => match.line)).toEqual([2])
})

it("returns structured workspace-relative search rows without reparsing path delimiters", async () => {
  await writeFile(join(root, "src", "index.ts"), "first\nneedle:value\nlast\n")

  const result = await environment.searchText("needle", "**/*.ts", 10)

  expect(result.matches).toEqual([{ path: "src/index.ts", line: 2, text: "needle:value" }])
  expect(result.truncated).toBe(false)
})

it("preserves the first matching lines and only reports truncation when more results exist", async () => {
  await writeFile(join(root, "src", "index.ts"), "needle first\nneedle second\n")

  const limited = await environment.searchText("needle", "**/*.ts", 1)
  const exact = await environment.searchText("needle", "**/*.ts", 2)

  expect(limited.matches).toEqual([{ path: "src/index.ts", line: 1, text: "needle first" }])
  expect(limited.truncated).toBe(true)
  expect(exact.matches).toHaveLength(2)
  expect(exact.truncated).toBe(false)
})

it("does not mark an exact result limit as truncated when later file batches have no matches", async () => {
  const longPrefix = "x".repeat(180)
  const paths = Array.from({ length: 200 }, (_, index) => `${String(index).padStart(3, "0")}-${longPrefix}.txt`)
  const firstPath = paths[0]!
  await Promise.all(paths.map((path, index) => writeFile(join(root, path), index === 0 ? "needle\n" : "nothing here\n")))

  const result = await environment.searchText("needle", "**/*", 1, false, paths)

  expect(result.matches).toEqual([{ path: firstPath, line: 1, text: "needle" }])
  expect(result.truncated).toBe(false)
})

it("reports regex syntax errors from ripgrep instead of applying JavaScript regex rules", async () => {
  await expect(environment.searchText("(?=needle)", "**/*.ts", 10)).rejects.toThrow()
})

it("searches text with ripgrep and returns workspace-relative matches", async () => {
  await writeFile(join(root, "src", "index.ts"), "first\nneedle value\nlast\n")
  const result = await environment.searchText("needle", "**/*.ts", 10)
  expect(result.matches).toEqual([{ path: "src/index.ts", line: 2, text: "needle value" }])
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

it("does not search a symlink supplied as a candidate path", async () => {
  await symlink(outsideFile, join(root, "linked-outside.txt"))

  await expect(environment.searchText("outside", "**/*", 10, false, ["linked-outside.txt"])).rejects.toThrow("regular workspace files")
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
  expect(() => environment.validatePatch("*** Begin Patch\n*** Update File: ../outside.txt\n@@\n-x\n+y\n*** End Patch")).toThrow("Patch path escapes workspace")
  expect(environment.validatePatch("*** Begin Patch\n*** Update File: src/index.ts\n@@\n-x\n+y\n*** End Patch")).toEqual(["src/index.ts"])
})
