import { Database } from "bun:sqlite"
import { expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { decodeParts } from "../../../src/contracts/message-parts"
import type { ResponseInputItem } from "../../../src/domain/chat/types"
import { ToolRegistry } from "../../../src/harness/agent/tool-registry"
import { LocalExecutionEnvironment } from "../../../src/harness/execution/local-execution-environment"
import { PermissionManager } from "../../../src/harness/permissions/permission-manager"
import { HarnessRuntime } from "../../../src/harness/runtime"
import { SqliteTurnStore } from "../../../src/harness/session/sqlite-turn-store"
import { configureConnection, migrate, type Db } from "../../../src/infrastructure/db/sqlite"

for (const milestone of ["begin", "calls", "first-output"]) {
  it(`recovers after process death at ${milestone} without executing old calls`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "ccodex-crash-"))
    const path = join(dir, "ccodex.db")
    const executions = join(dir, "executions")
    try {
      writeFileSync(executions, "")
      const setup = new Database(path) as unknown as Db
      try {
        configureConnection(setup)
        migrate(setup)
        setup.exec("INSERT INTO projects (id, key, name, fetched_at) VALUES ('101', 'P1', 'Project', 1)")
        setup.prepare("INSERT INTO sessions (id, project_id, directory, title, created_at, updated_at) VALUES ('s1', '101', ?, 'Chat', 1, 1)").run(dir)
      } finally {
        setup.close()
      }

      const crash = spawnSync(process.execPath, [join(import.meta.dir, "fixtures/crashing-turn.ts"), dir, milestone], { timeout: 5000 })
      expect(crash.error).toBeUndefined()
      expect(crash.signal, crash.stderr.toString()).toBe("SIGKILL")
      const db = new Database(path) as unknown as Db
      try {
        configureConnection(db, { synchronous: "FULL" })
        const store = new SqliteTurnStore(db)
        expect(store.recoverInterrupted()).toBe(1)
        const row = db.prepare("SELECT state, parts_json FROM messages WHERE client_request_id = 'first'").get() as { state: string; parts_json: string }
        expect(row.state).toBe("interrupted")
        const parts = decodeParts(row.parts_json)
        const ids = parts.map((part) => [part.type, "call_id" in part ? part.call_id : null])
        const calls = [["function_call", "one"], ["function_call", "two"]]
        const output = ["function_call_output", "one"]
        expect(ids).toEqual(milestone === "begin" ? [] : milestone === "calls" ? calls : [...calls, output])
        const expectedExecutions = milestone === "first-output" ? "one\n" : ""
        expect(readFileSync(executions, "utf8")).toBe(expectedExecutions)

        const tools = new ToolRegistry()
        tools.register({
          definition: { type: "function", name: "record", description: "Record a call", parameters: { type: "object" } },
          async execute() { appendFileSync(executions, "replayed\n"); return "replayed" },
        })
        const inputs: ResponseInputItem[][] = []
        await new Promise<void>((resolve, reject) => {
          const runtime = new HarnessRuntime({
            turns: store,
            tools,
            permissions: new PermissionManager(() => {}),
            createExecutionEnvironment: (path) => new LocalExecutionEnvironment(path),
            createChatModel: () => ({
              async *stream(request) {
                inputs.push(request.input)
                yield { type: "response.output-items", items: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Ready" }] }] }
              },
            }),
            emit(event) {
              if (event.type === "chat.completed") resolve()
              if (event.type === "chat.failed") reject(new Error(event.message))
            },
          })
          runtime.submit({ type: "chat.submit", sessionId: "s1", requestId: "next", model: "test",
            workspacePath: dir, prompt: "Continue", approvalMode: "manual" })
        })
        expect(inputs).toHaveLength(1)
        const toolItems = inputs[0]!.filter((item) => item.type === "function_call" || item.type === "function_call_output")
        expect(toolItems).toEqual(milestone === "first-output" ? [parts[0]!, parts[2]!] : [])
        expect(readFileSync(executions, "utf8")).toBe(expectedExecutions)
      } finally {
        db.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}
