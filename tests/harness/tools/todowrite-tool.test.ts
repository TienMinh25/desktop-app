import { expect, it } from "bun:test"
import { todoWriteTool } from "../../../src/harness/tools/todowrite-tool"
import { createToolTestContext } from "./tool-test-context"

it("stores a session checklist in memory and emits an update", async () => {
  const testContext = await createToolTestContext()
  try {
    const todos = [{ content: "write tests", status: "in_progress" }]
    const prepared = await todoWriteTool.prepare!({ todos }, testContext.context)
    expect(prepared.permissionRequests[0]).toMatchObject({ tool: "todowrite", resource: testContext.context.sessionId })
    expect(await todoWriteTool.execute({ todos }, testContext.context, prepared.data)).toContain("write tests")
    expect(testContext.todoUpdates).toEqual([[{ content: "write tests", status: "in_progress" }]])
  } finally { await testContext.cleanup() }
})

it("rejects oversized or malformed checklists", async () => {
  const testContext = await createToolTestContext()
  try {
    await expect(todoWriteTool.prepare!({ todos: "no" }, testContext.context)).rejects.toThrow("up to 100")
    await expect(todoWriteTool.prepare!({ todos: Array.from({ length: 101 }, () => ({ content: "todo", status: "pending" })) }, testContext.context)).rejects.toThrow("up to 100")
  } finally { await testContext.cleanup() }
})
