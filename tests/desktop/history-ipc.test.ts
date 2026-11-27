import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

test("history, media and preload agree at the Electron boundary", () => {
  // Keep Electron module mocks out of the other tests.
  const fixture = fileURLToPath(new URL("./fixtures/history-ipc.ts", import.meta.url))
  const run = spawnSync(process.execPath, [fixture], {
    encoding: "utf8", timeout: 8000, env: { ...process.env, ELECTRON_RENDERER_URL: "", BACKEND_HOST: "https://example.invalid" },
  })
  if (run.error || run.status !== 0) throw new Error(run.error?.message ?? run.stderr)
  expect(run.status).toBe(0)
})
