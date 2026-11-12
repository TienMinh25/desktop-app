import { spawn } from "node:child_process"
import { StringDecoder } from "node:string_decoder"
import { applyPatch as applyUnifiedPatch, parsePatch } from "diff"
import { constants } from "node:fs"
import { lstat, mkdir, open, realpath, stat, unlink } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { rgPath } from "@vscode/ripgrep"
import type { CommandResult, ExecutionEnvironment, FileListResult, ResolvedPath, TextFilePage, TextSearchResult, WorkspaceFile } from "./execution-environment"
import { globToRegExp } from "./path-pattern"

const EXCLUDED_GLOBS = ["--glob", "!.git/**", "--glob", "!node_modules/**", "--glob", "!dist/**", "--glob", "!out/**"]

/** Host-backed first adapter. It centralizes policy-sensitive OS calls behind ExecutionEnvironment. */
export class LocalExecutionEnvironment implements ExecutionEnvironment {
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
        const parentInfo = await lstat(ancestor)
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

  async readTextFile(path: string, maxBytes: number, expectedInsideWorkspace: boolean): Promise<string> {
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const fileInfo = await handle.stat()
      if (!fileInfo.isFile()) throw new Error("Expected a regular text file")
      if (fileInfo.size > maxBytes) throw new Error(`File exceeds the ${maxBytes}-byte limit`)

      let canonicalPath: string
      let canonicalWorkspace: string
      let pathInfo
      try {
        canonicalPath = await realpath(path)
        canonicalWorkspace = await realpath(this.workspacePath)
        pathInfo = await stat(canonicalPath)
      } catch {
        throw new Error("Could not verify the current file path identity")
      }
      if (fileInfo.dev !== pathInfo.dev || fileInfo.ino !== pathInfo.ino) {
        throw new Error("File path identity changed before it could be read")
      }
      if (expectedInsideWorkspace && !isWithin(canonicalWorkspace, canonicalPath)) {
        throw new Error("File path is no longer inside the workspace")
      }

      const buffer = Buffer.alloc(maxBytes + 1)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      if (bytesRead > maxBytes) throw new Error(`File exceeds the ${maxBytes}-byte limit`)
      const text = buffer.subarray(0, bytesRead).toString("utf8")
      if (text.includes("\0")) throw new Error("Binary files are not supported")
      return text
    } finally { await handle.close() }
  }

  async readTextFilePage(path: string, expectedInsideWorkspace: boolean, offset: number, limit: number): Promise<TextFilePage> {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 2_000) throw new Error("Invalid read page range")
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const fileInfo = await handle.stat()
      if (!fileInfo.isFile()) throw new Error("Expected a regular text file")
      if (fileInfo.size > 20_000_000) throw new Error("File exceeds the 20000000-byte limit")
      let canonicalPath: string, canonicalWorkspace: string, pathInfo
      try {
        canonicalPath = await realpath(path)
        canonicalWorkspace = await realpath(this.workspacePath)
        pathInfo = await stat(canonicalPath)
      } catch { throw new Error("Could not verify the current file path identity") }
      if (fileInfo.dev !== pathInfo.dev || fileInfo.ino !== pathInfo.ino) throw new Error("File path identity changed before it could be read")
      if (expectedInsideWorkspace && !isWithin(canonicalWorkspace, canonicalPath)) throw new Error("File path is no longer inside the workspace")

      const decoder = new StringDecoder("utf8"), page: string[] = []
      let pending = "", lineIndex = 0, bytes = 0, position = 0, more = false, ended = false
      const consumeLine = (rawLine: string) => {
        const lineNumber = lineIndex++
        if (lineNumber < offset) return
        if (page.length >= limit) { more = true; return }
        const original = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine
        const characters = Array.from(original)
        let line = characters.slice(0, 2_000).join("")
        if (characters.length > 2_000) line += " … [line truncated at 2,000 characters]"
        const available = 50_000 - bytes - (page.length ? 1 : 0)
        if (Buffer.byteLength(line, "utf8") > available) {
          if (page.length) { more = true; return }
          line = truncateUtf8(line, Math.max(0, available - 30)) + " … [page byte limit]"
        }
        page.push(line)
        bytes += Buffer.byteLength(line, "utf8") + (page.length > 1 ? 1 : 0)
      }

      while (!more) {
        const buffer = Buffer.alloc(8_192)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
        if (!bytesRead) { ended = true; pending += decoder.end(); break }
        position += bytesRead
        if (position > 20_000_000) throw new Error("File exceeds the 20000000-byte limit")
        const chunk = buffer.subarray(0, bytesRead)
        if (chunk.includes(0)) throw new Error("Binary files are not supported")
        pending += decoder.write(chunk)
        const parts = pending.split("\n")
        pending = parts.pop() ?? ""
        for (const line of parts) {
          consumeLine(line)
          if (more) break
        }
      }

      if (ended && !more && pending.length) consumeLine(pending)
      const endLine = offset + page.length
      return {
        content: page.join("\n"), startLine: page.length ? offset + 1 : 0, endLine,
        ...(more ? { nextOffset: endLine } : { totalLines: lineIndex }),
      }
    } finally { await handle.close() }
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
    const matcher = globToRegExp(pattern)
    const workspace = await realpath(this.workspacePath)
    const output = await runRipgrep(["--files", "--hidden", "--no-config", "--no-ignore", "--glob", pattern, ...EXCLUDED_GLOBS], workspace, 4_000_000, 15_000)
    if (output.exitCode !== 0 && output.exitCode !== 1) throw new Error(output.stderr || `ripgrep exited ${output.exitCode}`)
    const paths = output.stdout.split(/\r?\n/).filter(Boolean)
    const matches = new Map<string, WorkspaceFile>()
    for (const relativePath of paths) {
      const normalizedPath = relativePath.replaceAll("\\", "/")
      matches.set(normalizedPath, { absolutePath: join(workspace, relativePath), relativePath: normalizedPath })
      const segments = normalizedPath.split("/")
      for (let index = 1; index < segments.length; index += 1) {
        const directoryPath = segments.slice(0, index).join("/")
        if (matcher.test(directoryPath)) matches.set(directoryPath, { absolutePath: join(workspace, ...segments.slice(0, index)), relativePath: directoryPath })
      }
    }
    const allMatches = [...matches.values()].filter((entry) => matcher.test(entry.relativePath)).sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    const truncated = output.truncated || allMatches.length > maxFiles
    return { files: allMatches.slice(0, maxFiles), visitedEntries: paths.length, truncated }
  }

  async searchText(pattern: string, glob: string, maxResults = 500): Promise<TextSearchResult> {
    const workspace = await realpath(this.workspacePath)
    const output = await runRipgrep([
      "--json", "--hidden", "--no-config", "--no-ignore", "--max-filesize", "1M",
      "--glob", glob, ...EXCLUDED_GLOBS, "--", pattern, ".",
    ], workspace, 20_000_000, 15_000)
    if (output.exitCode !== 0 && output.exitCode !== 1) throw new Error(output.stderr || `ripgrep exited ${output.exitCode}`)
    const matches: string[] = []
    let malformed = false
    for (const line of output.stdout.split(/\r?\n/)) {
      if (!line) continue
      try {
        const event = JSON.parse(line) as { type?: string; data?: { path?: { text?: string }; lines?: { text?: string }; line_number?: number } }
        if (event.type !== "match" || !event.data) continue
        const path = event.data.path?.text
        const lineNumber = event.data.line_number
        const text = event.data.lines?.text?.replace(/\r?\n$/, "")
        if (path === undefined || lineNumber === undefined || text === undefined) continue
        matches.push(`${path.replace(/^\.\//, "")}:${lineNumber}:${text}`)
        if (matches.length >= maxResults) break
      } catch { malformed = true; break }
    }
    return { matches, truncated: output.truncated || malformed || matches.length >= maxResults }
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
    const timeoutMs = Math.min(Math.max(requestedTimeout, 1000), 120_000)
    const shell = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "/bin/sh"
    const shellArgs = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command]
    const safeEnv: NodeJS.ProcessEnv = {}
    for (const key of ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "TERM", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) {
      if (process.env[key] !== undefined) safeEnv[key] = process.env[key]
    }
    return new Promise((resolveResult, reject) => {
      const child = spawn(shell, shellArgs, { cwd: this.workspacePath, env: safeEnv, windowsHide: true, detached: process.platform !== "win32" })
      let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0), stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0), outputTruncated = false, timedOut = false
      const append = (current: Buffer, chunk: Buffer) => {
        const remaining = 50_000 - stdout.length - stderr.length
        if (remaining <= 0) { outputTruncated = true; return current }
        const accepted = chunk.subarray(0, remaining)
        if (accepted.length < chunk.length) outputTruncated = true
        return Buffer.concat([current, accepted])
      }
      child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk) })
      child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk) })
      const timer = setTimeout(() => {
        timedOut = true
        if (process.platform !== "win32" && child.pid) {
          try { process.kill(-child.pid, "SIGTERM") } catch { child.kill("SIGTERM") }
          const forceTimer = setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL") } catch { /* process already exited */ } }, 1000)
          forceTimer.unref()
        } else {
          if (process.platform === "win32" && child.pid) {
            const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
            killer.on("error", () => {})
          }
          child.kill()
        }
      }, timeoutMs)
      child.on("error", (error) => { clearTimeout(timer); reject(error) })
      child.on("close", (exitCode, signal) => {
        clearTimeout(timer)
        resolveResult({ exitCode, signal, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"), timedOut, outputTruncated })
      })
    })
  }

  close() { /* No persistent host resources in this adapter yet. */ }
}

function truncateUtf8(value: string, maxBytes: number) {
  let output = "", bytes = 0
  for (const character of value) {
    const size = Buffer.byteLength(character, "utf8")
    if (bytes + size > maxBytes) break
    output += character
    bytes += size
  }
  return output
}

function isWithin(root: string, target: string) {
  const rel = relative(root, target)
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
}

function normalizePatchPath(path: string) {
  return path.replace(/^[ab]\//, "").replaceAll("\\", "/")
}

function runRipgrep(args: string[], cwd: string, maxOutputBytes: number, timeoutMs: number): Promise<{ exitCode: number | null; stdout: string; stderr: string; truncated: boolean }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(rgPath, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), truncated = false, timedOut = false
    const append = (current: Buffer, chunk: Buffer, limit: number) => Buffer.concat([current, chunk]).subarray(-limit)
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk, maxOutputBytes)
      if (stdout.length >= maxOutputBytes) { truncated = true; child.kill() }
    })
    child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk, 8_000) })
    const timer = setTimeout(() => { timedOut = true; truncated = true; child.kill() }, timeoutMs)
    child.on("error", (error) => { clearTimeout(timer); reject(error) })
    child.on("close", (exitCode) => {
      clearTimeout(timer)
      resolveResult({ exitCode, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8") || (timedOut ? "ripgrep timed out" : ""), truncated })
    })
  })
}
