import { Database } from "bun:sqlite"
import { appendFileSync } from "node:fs"
import { join } from "node:path"
import { ToolRegistry } from "../../../../src/harness/agent/tool-registry"
import { LocalExecutionEnvironment } from "../../../../src/harness/execution/local-execution-environment"
import { PermissionManager } from "../../../../src/harness/permissions/permission-manager"
import { HarnessRuntime } from "../../../../src/harness/runtime"
import { SqliteTurnStore } from "../../../../src/harness/session/sqlite-turn-store"
import type { BeginTurnInput, TurnStore } from "../../../../src/harness/session/turn-store"
import { configureConnection, type Db } from "../../../../src/infrastructure/db/sqlite"

const [dir, milestone] = process.argv.slice(2) as [string, string]
const db = new Database(join(dir, "ccodex.db")) as unknown as Db
configureConnection(db, { synchronous: "FULL" })

class CrashingStore extends SqliteTurnStore {
  override beginTurn(input: BeginTurnInput) {
    const result = super.beginTurn(input)
    if (milestone === "begin") process.kill(process.pid, "SIGKILL")
    return result
  }

  override appendSteps(...args: Parameters<TurnStore["appendSteps"]>) {
    super.appendSteps(...args)
    const type = args[1][0]?.type
    if ((milestone === "calls" && type === "function_call") ||
        (milestone === "first-output" && type === "function_call_output")) {
      process.kill(process.pid, "SIGKILL")
    }
  }
}

const tools = new ToolRegistry()
tools.register({
  definition: { type: "function", name: "record", description: "Record a call", parameters: { type: "object" } },
  async execute(args) {
    const { id } = args as { id: string }
    appendFileSync(join(dir, "executions"), id + "\n")
    return id
  },
})
const runtime = new HarnessRuntime({
  turns: new CrashingStore(db),
  tools,
  permissions: new PermissionManager(() => {}),
  createExecutionEnvironment: (path) => new LocalExecutionEnvironment(path),
  createChatModel: () => ({
    async *stream() {
      yield { type: "response.output-items", items: ["one", "two"].map((id) => ({
        type: "function_call", id: "fc-" + id, call_id: id, name: "record", arguments: JSON.stringify({ id }),
      })) }
    },
  }),
  emit(event) {
    if (event.type === "chat.failed") throw new Error(event.message)
  },
})
runtime.submit({ type: "chat.submit", sessionId: "s1", requestId: "first", model: "test",
  workspacePath: dir, prompt: "Record both calls", approvalMode: "manual" })
