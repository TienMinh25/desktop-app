import { spawn, type ChildProcessByStdio } from "node:child_process"
import type { Readable, Writable } from "node:stream"
import { pathToFileURL } from "node:url"
import type { LspQueryOperation } from "./types"

interface LspDiagnostic { range?: unknown; severity?: number; message?: string; source?: string; code?: string | number }
type LspChild = ChildProcessByStdio<Writable, Readable, Readable>

export class LspClient {
  private readonly child: LspChild
  private buffer = Buffer.alloc(0)
  private expectedLength?: number
  private nextId = 0
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  private readonly diagnostics = new Map<string, LspDiagnostic[]>()
  private readonly openDocuments = new Map<string, { text: string; version: number }>()
  private readonly diagnosticWaiters = new Map<string, Array<(items: LspDiagnostic[]) => void>>()
  private closed = false
  private initialized?: Promise<void>

  constructor(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
    this.child = spawn(command, args, { cwd, env, stdio: "pipe", windowsHide: true })
    this.child.stdout.on("data", (chunk: Buffer) => this.consume(chunk))
    this.child.stderr.on("data", () => { /* drain server logs */ })
    this.child.on("error", (error) => this.failAll(error))
    this.child.on("close", (code, signal) => this.failAll(new Error(`Language server exited (${code ?? signal})`)))
  }

  async open(rootPath: string, filePath: string, languageId: string, text: string) {
    if (!this.initialized) this.initialized = this.initialize(rootPath)
    await this.initialized
    const uri = pathToFileURL(filePath).href
    const previous = this.openDocuments.get(uri)
    const version = (previous?.version ?? 0) + 1
    if (!previous) this.notify("textDocument/didOpen", { textDocument: { uri, languageId, version, text } })
    else if (previous.text !== text) {
      this.notify("textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ text }] })
      this.diagnostics.delete(uri)
    }
    this.openDocuments.set(uri, { text, version })
    return uri
  }

  async query(operation: LspQueryOperation, uri: string, line: number, character: number): Promise<unknown> {
    const method = { definition: "textDocument/definition", references: "textDocument/references", hover: "textDocument/hover" }[operation]
    const params = {
      textDocument: { uri },
      position: { line: Math.max(0, line - 1), character: Math.max(0, character - 1) },
      ...(operation === "references" ? { context: { includeDeclaration: true } } : {}),
    }
    return this.request(method, params)
  }

  async getDiagnostics(uri: string): Promise<LspDiagnostic[]> {
    const cached = this.diagnostics.get(uri)
    if (cached) return cached
    return new Promise((resolve) => {
      const waiters = this.diagnosticWaiters.get(uri) ?? []
      const timer = setTimeout(() => {
        const current = this.diagnosticWaiters.get(uri) ?? []
        this.diagnosticWaiters.set(uri, current.filter((waiter) => waiter !== done))
        resolve(this.diagnostics.get(uri) ?? [])
      }, 1500)
      const done = (items: LspDiagnostic[]) => { clearTimeout(timer); resolve(items) }
      waiters.push(done)
      this.diagnosticWaiters.set(uri, waiters)
    })
  }

  close() { this.closed = true; this.child.kill(); this.failAll(new Error("Language server closed")) }

  private async initialize(rootPath: string) {
    await this.request("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(rootPath).href,
      capabilities: {},
      workspaceFolders: [{ uri: pathToFileURL(rootPath).href, name: rootPath.split(/[\\/]/).at(-1) ?? "workspace" }],
    })
    this.notify("initialized", {})
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("Language server is not running"))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`LSP request timed out: ${method}`)) }, 30_000)
      this.pending.set(id, { resolve, reject, timer })
      this.send({ jsonrpc: "2.0", id, method, params })
    })
  }

  private notify(method: string, params: Record<string, unknown>) { this.send({ jsonrpc: "2.0", method, params }) }

  private send(message: unknown) {
    const body = Buffer.from(JSON.stringify(message), "utf8")
    this.child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]))
  }

  private consume(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    if (this.buffer.length > 10_000_000) return this.failAll(new Error("LSP message buffer exceeded 10 MB"))
    while (true) {
      if (this.expectedLength === undefined) {
        const separator = this.buffer.indexOf("\r\n\r\n")
        if (separator < 0) return
        const headers = this.buffer.subarray(0, separator).toString("ascii")
        const match = headers.match(/Content-Length:\s*(\d+)/i)
        if (!match) return this.failAll(new Error("Invalid LSP frame: missing Content-Length"))
        this.expectedLength = Number(match[1])
        this.buffer = this.buffer.subarray(separator + 4)
      }
      if (this.buffer.length < this.expectedLength) return
      const body = this.buffer.subarray(0, this.expectedLength).toString("utf8")
      this.buffer = this.buffer.subarray(this.expectedLength)
      this.expectedLength = undefined
      try { this.handle(JSON.parse(body) as Record<string, unknown>) }
      catch (error) { this.failAll(new Error(`Invalid LSP response: ${error instanceof Error ? error.message : String(error)}`)) }
    }
  }

  private handle(message: Record<string, unknown>) {
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id); clearTimeout(pending.timer)
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)))
      else pending.resolve(message.result)
      return
    }
    if (message.method === "textDocument/publishDiagnostics") {
      const params = message.params as { uri?: string; diagnostics?: LspDiagnostic[] } | undefined
      if (!params?.uri) return
      const items = params.diagnostics ?? []
      this.diagnostics.set(params.uri, items)
      for (const waiter of this.diagnosticWaiters.get(params.uri) ?? []) waiter(items)
      this.diagnosticWaiters.delete(params.uri)
    }
  }

  private failAll(error: Error) {
    this.closed = true
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
    this.pending.clear()
    if (!this.child.killed) this.child.kill()
  }
}
