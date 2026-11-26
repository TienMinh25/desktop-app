import { Database } from "bun:sqlite"
import { expect, mock } from "bun:test"
import { EventEmitter } from "node:events"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const directory = mkdtempSync(join(tmpdir(), "history-ipc-"))
const appReady = Promise.withResolvers<void>()
const mediaReady = Promise.withResolvers<(request: Request) => Response>()
const frame = { url: new URL("../../../src/desktop/renderer/index.html", import.meta.url).href }
const event = { sender: { mainFrame: frame }, senderFrame: frame }
const channels: string[] = []
const handlers = new Map<string, (sender: typeof event, ...args: unknown[]) => Promise<unknown>>()
let desktop!: Window["desktop"]
let privileges: unknown
const appEvents = new EventEmitter()
const quit = Promise.withResolvers<void>()

mock.module("better-sqlite3", () => ({ default: Database }))
mock.module("electron-updater", () => ({ default: { autoUpdater: new EventEmitter() } }))
mock.module("electron", () => ({
  app: Object.assign(appEvents, {
    getPath: () => directory,
    requestSingleInstanceLock: () => true,
    whenReady() {
      expect(privileges).toEqual([{ scheme: "ccodex-media", privileges: {
        standard: true, secure: true, stream: true, supportFetchAPI: true,
      } }])
      return appReady.promise
    },
    quit: quit.resolve,
  }),
  ipcMain: { on() {}, handle: handlers.set.bind(handlers) },
  ipcRenderer: { invoke(channel: string, ...args: unknown[]) {
    channels.push(channel)
    return handlers.get(channel)!(event, ...args)
  } },
  contextBridge: { exposeInMainWorld(name: string, api: Window["desktop"]) {
    expect(name).toBe("desktop")
    desktop = api
  } },
  BrowserWindow: { fromWebContents: () => ({}), getAllWindows: () => [{ isMinimized: () => false, focus() {} }] },
  protocol: {
    registerSchemesAsPrivileged(value: unknown) { privileges = value },
    handle(scheme: string, handler: (request: Request) => Response) {
      expect(scheme).toBe("ccodex-media")
      mediaReady.resolve(handler)
    },
  },
  safeStorage: {}, dialog: {}, screen: {}, shell: {}, utilityProcess: { fork() { throw new Error("No harness in IPC test") } },
}))

try {
  await import("../../../src/desktop/main/index")
  await import("../../../src/desktop/preload/index")
  appReady.resolve()
  const serve = await mediaReady.promise
  const db = new Database(join(directory, ".ccodex", "ccodex.db"))
  db.exec(`INSERT INTO projects (id, key, name, is_assigned, fetched_at) VALUES ('p', 'P', 'Project', 1, 1);
    INSERT INTO sessions (id, project_id, directory, title, created_at, updated_at) VALUES ('s', 'p', '/', 'Chat', 1, 1);
    INSERT INTO messages (session_id, seq, role, updated_at, parts_json) VALUES ('s', 1, 'user', 1, '{"v":1,"parts":[{"type":"text","text":"old prompt"}]}')`)
  const hash = "a".repeat(64)
  db.query("INSERT INTO media_blob (sha256, mime, bytes, data, created_at) VALUES (?, 'image/png', 2, ?, 1)").run(hash, new Uint8Array([1, 2]))
  const request = new Request(`ccodex-media://${hash}`)
  expect(serve(request).status).toBe(404)
  db.query("INSERT INTO artifacts (message_id, direction, path, name, mime_type, size_bytes, created_at, sha256) VALUES (1, 'in', ?, 'image', 'image/png', 2, 1, ?)").run(`media:${hash}`, hash)
  const response = serve(request)
  expect(response.status).toBe(200)
  expect(response.headers.get("content-type")).toBe("image/png")
  expect(await response.bytes()).toEqual(new Uint8Array([1, 2]))
  db.close()

  expect(await desktop.listSessionHistory(" s ")).toMatchObject([{ prompt: "old prompt" }])
  await expect(desktop.listSessionHistory(" ")).rejects.toThrow("sessionId must be a non-empty string")
  expect(await desktop.openMediaPath("relative.pdf")).toEqual({ ok: false, error: "not-allowed" })
  expect(channels).toEqual(["sessions:history", "sessions:history", "media:open-path"])
  event.senderFrame = { url: frame.url }
  await expect(desktop.listSessionHistory("s")).rejects.toThrow("Untrusted IPC sender")
  await expect(desktop.openMediaPath("/doc.pdf")).rejects.toThrow("Untrusted IPC sender")
} finally {
  appEvents.emit("before-quit", { preventDefault() {} })
  if (appEvents.listenerCount("before-quit")) await quit.promise
  rmSync(directory, { recursive: true, force: true })
}
