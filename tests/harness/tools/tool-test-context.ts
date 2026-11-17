import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PermissionRequirement } from "../../../src/harness/permissions/permission-manager"
import { LocalExecutionEnvironment } from "../../../src/harness/execution/local-execution-environment"
import type { ToolContext } from "../../../src/harness/agent/tool-registry"
import type { TodoInput } from "../../../src/contracts/todos"

export async function createToolTestContext() {
  const workspacePath = await mkdtemp(join(tmpdir(), "harness-tool-"))
  const permissionRequirements: PermissionRequirement[] = []
  const todoUpdates: TodoInput[][] = []
  const context: ToolContext = {
    workspacePath,
    requestId: "request-test",
    sessionId: `session-${Math.random()}`,
    environment: new LocalExecutionEnvironment(workspacePath),
    async requirePermission(requirement) { permissionRequirements.push(requirement) },
    async askUser() { return "test answer" },
    todoScope: { type: "request", id: "request-test" },
    updateTodos(todos) {
      todoUpdates.push(structuredClone(todos))
      return todos.map((todo, index) => ({ ...todo, id: todo.id ?? `todo-${index + 1}` }))
    },
  }
  return {
    context,
    permissionRequirements,
    todoUpdates,
    async cleanup() { await rm(workspacePath, { recursive: true, force: true }) },
  }
}
