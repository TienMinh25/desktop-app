import { spawn, type ChildProcess } from "node:child_process"
import { applyPatch as applyUnifiedPatch, parsePatch } from "diff"
import { constants } from "node:fs"
import type { Stats } from "node:fs"
import { lstat, mkdir, open, realpath, stat, unlink } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import type { CommandResult, ExecutionEnvironment, FileListResult, ResolvedPath, TextFilePage, TextSearchResult } from "./execution-environment"
import { resolveShellInvocation } from "./shell-selector"
import { READ_LIMITS } from "./read-limits"
import { RipgrepRunner } from "./ripgrep-runner"

interface ActiveShellProcess {
  child: ChildProcess
  os: string
  timeoutTimer?: ReturnType<typeof setTimeout>
  forceKillTimer?: ReturnType<typeof setTimeout>
  terminating: boolean
}

/** Host-backed first adapter. It centralizes policy-sensitive OS calls behind ExecutionEnvironment. */
export class LocalExecutionEnvironment implements ExecutionEnvironment {
  private environmentClosed = false
  private readonly activeProcesses = new Map<ChildProcess, ActiveShellProcess>()
  private readonly ripgrep = new RipgrepRunner()

  constructor(readonly workspacePath: string) {}

  async resolvePath(input: string, allowMissing = false): Promise<ResolvedPath> {
    const workspace = await realpath(this.workspacePath)
    const candidate = resolve(isAbsolute(input) ? input : resolve(workspace, input))
    if (!allowMissing) {
      const actual = await realpath(candidate)
      return { path: actual, insideWorkspace: isWithin(workspace, actual) }
    }
    let info
    try { info = await lstat(candidate) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
    if (info) {
      const actual = await realpath(candidate)
      return { path: actual, insideWorkspace: isWithin(workspace, actual) }
    }
    const missing: string[] = []
    let ancestor = candidate
    while (true) {
      try {
        const actualParent = await realpath(ancestor)
        const target = resolve(actualParent, ...missing.reverse())
        return { path: target, insideWorkspace: isWithin(workspace, target) }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        const parent = dirname(ancestor)
        if (parent === ancestor) throw error
        missing.push(ancestor.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)))
        ancestor = parent
      }
    }
  }

  async readFileBytes(path: string, maxBytes: number, expectedInsideWorkspace: boolean): Promise<Uint8Array> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error("Invalid file size limit")
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const fileInfo = await handle.stat()
      if (!fileInfo.isFile()) throw new Error("Expected a regular file")
      if (fileInfo.size > maxBytes) throw new Error(`File exceeds the ${maxBytes}-byte limit`)
      await this.verifyReadIdentity(path, fileInfo, expectedInsideWorkspace)

      const chunks: Buffer[] = []
      let totalBytes = 0
      while (totalBytes <= maxBytes) {
        const buffer = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1 - totalBytes))
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, totalBytes)
        if (!bytesRead) break
        chunks.push(buffer.subarray(0, bytesRead))
        totalBytes += bytesRead
      }
      if (totalBytes > maxBytes) throw new Error(`File exceeds the ${maxBytes}-byte limit`)
      return Buffer.concat(chunks, totalBytes)
    } finally { await handle.close() }
  }

  async readTextFile(path: string, maxBytes: number, expectedInsideWorkspace: boolean): Promise<string> {
    const bytes = await this.readFileBytes(path, maxBytes, expectedInsideWorkspace)
    const text = decodeUtf8(bytes)
    if (text.includes("\0")) throw new Error("Binary files are not supported")
    return text
  }

  async readTextFilePage(path: string, expectedInsideWorkspace: boolean, offset: number, limit: number, columnOffset = 0): Promise<TextFilePage> {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > READ_LIMITS.pageLines || !Number.isInteger(columnOffset) || columnOffset < 0) {
      throw new Error("Invalid read page range")
    }
    const bytes = await this.readFileBytes(path, READ_LIMITS.textFileBytes, expectedInsideWorkspace)
    const text = decodeUtf8(bytes)
    if (text.includes("\0")) throw new Error("Binary files are not supported")
    const totalLines = countTextLines(text)
    if (offset > totalLines) throw new Error("offset is past the end of the file")

    let lineStart = 0
    if (offset === totalLines) {
      lineStart = text.length
    } else {
      for (let lineNumber = 0; lineNumber < offset; lineNumber += 1) {
        const newline = text.indexOf("\n", lineStart)
        if (newline < 0) throw new Error("offset is past the end of the file")
        lineStart = newline + 1
      }
    }
    const page: string[] = []
    let pageBytes = 0
    let lineIndex = offset
    let column = columnOffset
    let nextOffset: number | undefined
    let nextColumnOffset: number | undefined

    while (lineIndex < totalLines && page.length < limit) {
      const newline = text.indexOf("\n", lineStart)
      const rawLineEnd = newline < 0 ? text.length : newline
      const lineEnd = rawLineEnd > lineStart && text.charCodeAt(rawLineEnd - 1) === 13 ? rawLineEnd - 1 : rawLineEnd
      const lineLength = lineEnd - lineStart
      if (column > lineLength || splitsSurrogatePair(text, lineStart, column, lineEnd)) {
        throw new Error("columnOffset is past the end of the selected line or splits a Unicode character")
      }
      const available = READ_LIMITS.pageBytes - pageBytes - (page.length ? 1 : 0)
      if (available <= 0) {
        nextOffset = lineIndex
        nextColumnOffset = column
        break
      }

      const chunkEnd = takeUtf8StringEnd(text, lineStart + column, lineEnd, available)
      const chunk = text.slice(lineStart + column, chunkEnd)
      page.push(chunk)
      pageBytes += Buffer.byteLength(chunk, "utf8") + (page.length > 1 ? 1 : 0)

      if (chunkEnd < lineEnd) {
        nextOffset = lineIndex
        nextColumnOffset = chunkEnd - lineStart
        break
      }
      lineIndex += 1
      lineStart = newline < 0 ? text.length : newline + 1
      column = 0
    }

    if (nextOffset === undefined && lineIndex < totalLines) {
      nextOffset = lineIndex
      nextColumnOffset = 0
    }
    return {
      content: page.join("\n"),
      startLine: page.length ? offset + 1 : 0,
      endLine: page.length ? offset + page.length : offset,
      ...(nextOffset === undefined ? { totalLines } : { nextOffset, ...(nextColumnOffset ? { nextColumnOffset } : {}) }),
    }
  }

  private async verifyReadIdentity(path: string, fileInfo: Stats, expectedInsideWorkspace: boolean) {
    let canonicalPath: string, canonicalWorkspace: string, pathInfo
    try {
      canonicalPath = await realpath(path)
      canonicalWorkspace = await realpath(this.workspacePath)
      pathInfo = await stat(canonicalPath)
    } catch {
      throw new Error("Could not verify the current file path identity")
    }
    if (fileInfo.dev !== pathInfo.dev || fileInfo.ino !== pathInfo.ino) throw new Error("File path identity changed before it could be read")
    if (expectedInsideWorkspace && !isWithin(canonicalWorkspace, canonicalPath)) throw new Error("File path is no longer inside the workspace")
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    if (await realpath(dirname(path)) !== dirname(path)) throw new Error("Refusing to write after the parent path changed")
    let flags: number
    try {
      const info = await lstat(path)
      if (info.isSymbolicLink()) throw new Error("Refusing to write through a symbolic link")
      if (!info.isFile()) throw new Error("write expects a regular file path")
      flags = constants.O_WRONLY | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0)
    }
    const handle = await open(path, flags, 0o666)
    try { await handle.writeFile(content, "utf8") }
    finally { await handle.close() }
  }

  async listFiles(pattern: string, maxFiles = 20_000): Promise<FileListResult> {
    const workspace = await realpath(this.workspacePath)
    return await this.ripgrep.listFiles(workspace, pattern, maxFiles)
  }

  async searchText(pattern: string, glob: string, maxResults = 500, caseSensitive = false, candidatePaths?: string[]): Promise<TextSearchResult> {
    const workspace = await realpath(this.workspacePath)
    return await this.ripgrep.searchText(workspace, pattern, glob, maxResults, caseSensitive, candidatePaths)
  }

  async applyPatch(patch: string): Promise<string> {
    const paths = this.validatePatch(patch)
    const parsed = parsePatch(patch)
    if (parsed.length !== paths.length) throw new Error("Patch could not be parsed as a unified diff")
    const changes: Array<{ path: string; content: string | null }> = []
    for (const filePatch of parsed) {
      if (filePatch.isRename || filePatch.isCopy) throw new Error("Patch rename and copy operations are not supported")
      const oldName = filePatch.oldFileName ? normalizePatchPath(filePatch.oldFileName) : undefined
      const newName = filePatch.newFileName ? normalizePatchPath(filePatch.newFileName) : undefined
      const sourceName = oldName === "/dev/null" ? undefined : oldName
      const targetName = newName === "/dev/null" ? sourceName : newName
      if (!targetName || (sourceName && sourceName !== targetName)) throw new Error("Patch must identify one unchanged workspace path per file")
      const workspace = await realpath(this.workspacePath)
      const candidatePath = resolve(workspace, targetName)
      const target = await this.resolvePath(targetName, true)
      if (!target.insideWorkspace) throw new Error(`Patch path escapes workspace: ${targetName}`)
      let source = ""
      if (sourceName) {
        const info = await lstat(candidatePath)
        if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Patch target must be a regular file, not a symbolic link: ${targetName}`)
        source = await this.readTextFile(target.path, 2_000_000, true)
      } else {
        try { await lstat(candidatePath); throw new Error(`Patch create target already exists: ${targetName}`) }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
      }
      if (filePatch.newFileName === "/dev/null" || filePatch.isDelete) {
        const updated = applyUnifiedPatch(source, filePatch, { fuzzFactor: 0 })
        if (updated === false || updated !== "") throw new Error(`Patch did not delete the expected file content: ${targetName}`)
        changes.push({ path: target.path, content: null })
      } else {
        const updated = applyUnifiedPatch(source, filePatch, { fuzzFactor: 0 })
        if (updated === false) throw new Error(`Patch did not apply cleanly to ${targetName}`)
        changes.push({ path: target.path, content: updated })
      }
    }
    for (const change of changes) {
      if (change.content === null) await unlink(change.path)
      else await this.writeTextFile(change.path, change.content)
    }
    return `Patch applied to ${[...new Set(paths)].join(", ")}`
  }

  validatePatch(patch: string): string[] {
    if (Buffer.byteLength(patch, "utf8") > 1_000_000) throw new Error("Patch exceeds the 1 MB limit")
    if (!patch.includes("diff --git") && !patch.startsWith("--- ")) throw new Error("Expected a unified diff")
    const paths = [...patch.matchAll(/^(?:\+\+\+|---) (?:[ab]\/)?(.+)$/gm)].map((match) => (match[1] ?? "").trim()).filter((path) => path !== "/dev/null")
    if (!paths.length) throw new Error("Patch does not identify any target files")
    for (const path of paths) {
      if (path.startsWith("/") || path.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(path) || path.split(/[\\/]/).includes("..")) throw new Error(`Patch path escapes workspace: ${path}`)
    }
    return [...new Set(paths)]
  }

  async runCommand(command: string, requestedTimeout = 120_000): Promise<CommandResult> {
    if (this.environmentClosed) throw new Error("Execution environment is closed")
    const timeoutMs = Math.min(Math.max(requestedTimeout, 1000), 120_000)
    const invocation = resolveShellInvocation(command, process.platform, process.env)
    const safeEnv: NodeJS.ProcessEnv = {}
    for (const key of ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "TERM", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) {
      if (process.env[key] !== undefined) safeEnv[key] = process.env[key]
    }
    return new Promise((resolveResult, reject) => {
      const child = spawn(invocation.executable, invocation.args, {
        cwd: this.workspacePath,
        env: safeEnv,
        windowsHide: true,
        detached: invocation.os !== "Windows",
        ...(invocation.windowsVerbatimArguments === undefined ? {} : { windowsVerbatimArguments: invocation.windowsVerbatimArguments }),
      })
      let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0), stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0), outputTruncated = false, timedOut = false
      const active: ActiveShellProcess = { child, os: invocation.os, terminating: false }
      const append = (current: Buffer, chunk: Buffer) => {
        const remaining = 50_000 - stdout.length - stderr.length
        if (remaining <= 0) { outputTruncated = true; return current }
        const accepted = chunk.subarray(0, remaining)
        if (accepted.length < chunk.length) outputTruncated = true
        return Buffer.concat([current, accepted])
      }
      child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk) })
      child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk) })
      active.timeoutTimer = setTimeout(() => {
        timedOut = true
        this.terminateProcess(active)
      }, timeoutMs)
      this.activeProcesses.set(child, active)
      child.on("error", (error) => {
        clearTimeout(active.timeoutTimer)
        this.activeProcesses.delete(child)
        reject(error)
      })
      child.on("close", (exitCode, signal) => {
        clearTimeout(active.timeoutTimer)
        this.activeProcesses.delete(child)
        resolveResult({ exitCode, signal, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"), timedOut, outputTruncated })
      })
    })
  }

  private terminateProcess(active: ActiveShellProcess): void {
    if (active.terminating) return
    active.terminating = true
    const { child, os } = active
    if (os !== "Windows" && child.pid) {
      try { process.kill(-child.pid, "SIGTERM") }
      catch { try { child.kill("SIGTERM") } catch { /* process already exited */ } }
      active.forceKillTimer = setTimeout(() => {
        try { process.kill(-child.pid!, "SIGKILL") } catch { /* process group already exited */ }
      }, 1000)
      return
    }
    if (os === "Windows" && child.pid) {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
      let fallbackSent = false
      const fallback = () => {
        if (fallbackSent) return
        fallbackSent = true
        try { child.kill() } catch { /* process already exited */ }
      }
      killer.once("error", fallback)
      killer.once("close", (exitCode) => {
        if (exitCode !== 0) fallback()
      })
      return
    }
    try { child.kill() } catch { /* process already exited */ }
  }

  close(): void {
    if (this.environmentClosed) return
    this.environmentClosed = true
    for (const active of this.activeProcesses.values()) {
      clearTimeout(active.timeoutTimer)
      this.terminateProcess(active)
    }
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes) }
  catch { throw new Error("File is not valid UTF-8 text") }
}

function countTextLines(text: string): number {
  if (text.length === 0) return 0
  let count = text.endsWith("\n") ? 0 : 1
  let position = -1
  while ((position = text.indexOf("\n", position + 1)) >= 0) count += 1
  return count
}

function takeUtf8StringEnd(text: string, start: number, end: number, maxBytes: number): number {
  let position = start
  let byteLength = 0
  while (position < end) {
    const codePoint = text.codePointAt(position)
    if (codePoint === undefined) break
    const width = codePoint > 0xffff ? 2 : 1
    const characterBytes = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : width === 2 ? 4 : 3
    if (byteLength + characterBytes > maxBytes) break
    byteLength += characterBytes
    position += width
  }
  return position
}

function splitsSurrogatePair(text: string, lineStart: number, column: number, lineEnd: number): boolean {
  const position = lineStart + column
  if (position <= lineStart || position >= lineEnd) return false
  const previous = text.charCodeAt(position - 1)
  const current = text.charCodeAt(position)
  return previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff
}

function isWithin(root: string, target: string) {
  const rel = relative(root, target)
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
}

function normalizePatchPath(path: string) {
  return path.replace(/^[ab]\//, "").replaceAll("\\", "/")
}
