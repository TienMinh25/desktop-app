import { spawn } from "node:child_process"
import { lstat } from "node:fs/promises"
import { rgPath } from "@vscode/ripgrep"
import { join } from "node:path"
import type { FileListResult, TextSearchResult, WorkspaceFile } from "./execution-environment"

const DEFAULT_TIMEOUT_MS = 15_000
const LIST_OUTPUT_BYTES = 4_000_000
const SEARCH_OUTPUT_BYTES = 20_000_000
const STDERR_BYTES = 8_000

interface RunOptions<T> {
  args: string[]
  cwd: string
  delimiter: 0 | 10
  maxItems: number
  maxOutputBytes: number
  parseRecord(record: Buffer): T | undefined
}

interface RunResult<T> {
  items: T[]
  truncated: boolean
}

/** Owns ripgrep process invocation, streaming output parsing, and result limits. */
export class RipgrepRunner {
  async listFiles(cwd: string, pattern: string, limit: number): Promise<FileListResult> {
    assertLimit(limit)
    const args = ["--no-config", "--no-require-git", "--files", "--null", "--sort", "path"]
    if (!isBroadGlob(pattern)) args.push("--glob", pattern)
    if (explicitlyNamesHiddenPath(pattern)) args.push("--hidden")
    args.push(".")
    const result = await runRipgrep<WorkspaceFile>({
      args,
      cwd,
      delimiter: 0,
      maxItems: limit,
      maxOutputBytes: LIST_OUTPUT_BYTES,
      parseRecord(record) {
        const relativePath = record.toString("utf8").replace(/^\.\//, "").replaceAll("\\", "/")
        if (!relativePath || isGitMetadataPath(relativePath)) return undefined
        return { absolutePath: join(cwd, ...relativePath.split("/")), relativePath }
      },
    })
    return { files: result.items, visitedEntries: result.items.length, truncated: result.truncated }
  }

  async searchText(
    cwd: string,
    pattern: string,
    glob: string,
    limit: number,
    caseSensitive = false,
    candidatePaths?: string[],
  ): Promise<TextSearchResult> {
    assertLimit(limit)
    const batches = candidatePaths ? batchPaths(candidatePaths) : [undefined]
    const matches: TextSearchResult["matches"] = []
    for (const paths of batches) {
      if (paths) await validateCandidatePaths(cwd, paths)
      const args = ["--no-config", "--no-require-git", "--json"]
      if (!paths && !isBroadGlob(glob)) args.push("--glob", glob)
      if (explicitlyNamesHiddenPath(glob)) args.push("--hidden")
      if (!caseSensitive) args.push("--ignore-case")
      args.push("--", pattern)
      if (paths) args.push(...paths)
      else args.push(".")
      const remaining = limit - matches.length
      const batchLimit = Math.max(remaining, 1)

      const result = await runRipgrep({
        args,
        cwd,
        delimiter: 10,
        maxItems: batchLimit,
        maxOutputBytes: SEARCH_OUTPUT_BYTES,
        parseRecord(record) {
          let event: unknown
          try { event = JSON.parse(record.toString("utf8")) }
          catch { throw new Error("Ripgrep returned malformed JSON output") }
          if (!isRecord(event) || event.type !== "match" || !isRecord(event.data)) return undefined

          const filePath = readRipgrepText(event.data.path)
          const line = event.data.line_number
          const text = readRipgrepText(event.data.lines)
          if (filePath === undefined || typeof line !== "number" || text === undefined) return undefined
          const normalizedPath = filePath.replace(/^\.\//, "").replaceAll("\\", "/")
          if (isGitMetadataPath(normalizedPath)) return undefined
          return {
            path: normalizedPath,
            line,
            text: text.replace(/\r?\n$/, ""),
          }
        },
      })
      if (remaining > 0) matches.push(...result.items.slice(0, remaining))
      if (remaining === 0 && result.items.length > 0) return { matches, truncated: true }
      if (result.truncated) return { matches, truncated: true }
    }
    return { matches, truncated: false }
  }
}

async function runRipgrep<T>(options: RunOptions<T>): Promise<RunResult<T>> {
  return await new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(rgPath, options.args, { cwd: options.cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    } catch (error) {
      reject(new Error(`Could not start ripgrep at ${rgPath}: ${errorMessage(error)}`))
      return
    }

    const items: T[] = []
    let pending = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let receivedBytes = 0
    let truncated = false
    let stoppedEarly = false
    let timedOut = false
    let parseError: Error | undefined
    const timeout = setTimeout(() => {
      timedOut = true
      stoppedEarly = true
      child.kill()
    }, DEFAULT_TIMEOUT_MS)
    const stopForLimit = () => {
      truncated = true
      stoppedEarly = true
      child.kill()
    }

    const parsePendingRecords = () => {
      let delimiterIndex = pending.indexOf(options.delimiter)
      while (delimiterIndex >= 0 && !stoppedEarly) {
        const record = pending.subarray(0, delimiterIndex)
        pending = pending.subarray(delimiterIndex + 1)
        if (record.length) {
          try {
            const item = options.parseRecord(record)
            if (item !== undefined) {
              items.push(item)
              if (items.length > options.maxItems) stopForLimit()
            }
          } catch (error) {
            parseError = error instanceof Error ? error : new Error(String(error))
            stoppedEarly = true
            child.kill()
          }
        }
        delimiterIndex = pending.indexOf(options.delimiter)
      }
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stoppedEarly) return
      const remainingBytes = options.maxOutputBytes - receivedBytes
      const acceptedChunk = chunk.subarray(0, Math.max(0, remainingBytes))
      receivedBytes += acceptedChunk.length
      pending = Buffer.concat([pending, acceptedChunk])
      parsePendingRecords()
      if (!stoppedEarly && acceptedChunk.length < chunk.length) stopForLimit()
    })

    child.stderr?.on("data", (chunk: Buffer) => {
      const remainingBytes = STDERR_BYTES - stderr.length
      if (remainingBytes > 0) stderr = Buffer.concat([stderr, chunk.subarray(0, remainingBytes)])
    })

    child.once("error", (error: Error) => {
      clearTimeout(timeout)
      reject(new Error(`Could not run ripgrep at ${rgPath}: ${error.message}`))
    })

    child.once("close", (exitCode: number | null) => {
      clearTimeout(timeout)
      if (parseError) {
        reject(parseError)
        return
      }
      if (timedOut) {
        reject(new Error(`Ripgrep search timed out after ${DEFAULT_TIMEOUT_MS} ms`))
        return
      }
      if (!stoppedEarly && pending.length) {
        try {
          const item = options.parseRecord(pending)
          if (item !== undefined) {
            items.push(item)
            if (items.length > options.maxItems) truncated = true
          }
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
          return
        }
      }

      const errorText = stderr.toString("utf8").trim()
      if (!stoppedEarly && exitCode !== 0 && exitCode !== 1) {
        reject(new Error(errorText || `Ripgrep exited with code ${exitCode}`))
        return
      }
      resolve({ items: items.slice(0, options.maxItems), truncated })
    })
  })
}

function readRipgrepText(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.text === "string") return value.text
  if (typeof value.bytes === "string") return Buffer.from(value.bytes, "base64").toString("utf8")
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Ripgrep result limit must be a positive integer")
}

function isBroadGlob(pattern: string): boolean {
  return pattern === "*" || pattern === "**" || pattern === "**/*"
}

function explicitlyNamesHiddenPath(pattern: string): boolean {
  return pattern.replaceAll("\\", "/").split("/").some((segment) => {
    if ((segment.startsWith(".") && segment !== "." && segment !== "..") || segment.startsWith("[.]")) return true
    for (const alternatives of segment.matchAll(/\{([^{}]*)\}/g)) {
      if (alternatives[1]?.split(",").some((alternative) => alternative.startsWith(".") || alternative.startsWith("[.]"))) return true
    }
    return false
  })
}

function isGitMetadataPath(path: string): boolean {
  return path === ".git" || path.startsWith(".git/") || path.includes("/.git/")
}

function batchPaths(paths: string[]): string[][] {
  const batches: string[][] = []
  let batch: string[] = []
  let bytes = 0
  for (const path of paths) {
    const pathBytes = Buffer.byteLength(path) + 1
    if (batch.length && bytes + pathBytes > 32_000) {
      batches.push(batch)
      batch = []
      bytes = 0
    }
    batch.push(path)
    bytes += pathBytes
  }
  if (batch.length) batches.push(batch)
  return batches
}

async function validateCandidatePaths(cwd: string, paths: string[]): Promise<void> {
  const checked = new Map<string, Promise<void>>()
  for (const path of paths) {
    const normalized = path.replaceAll("\\", "/")
    const segments = normalized.split("/")
    if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || segments.some((segment) => !segment || segment === "." || segment === "..") || isGitMetadataPath(normalized)) {
      throw new Error("Ripgrep candidate paths must be regular workspace files")
    }
    let current = cwd
    for (let index = 0; index < segments.length; index += 1) {
      current = join(current, segments[index]!)
      const isFile = index === segments.length - 1
      let validation = checked.get(current)
      if (!validation) {
        validation = (async () => {
          const info = await lstat(current)
          if (info.isSymbolicLink() || (isFile ? !info.isFile() : !info.isDirectory())) {
            throw new Error("Ripgrep candidate paths must be regular workspace files")
          }
        })()
        checked.set(current, validation)
      }
      await validation
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
