import type { HarnessTool } from "../agent/tool-registry"
import type { PermissionRequirement } from "../permissions/permission-manager"
import { definition, objectArgs } from "./tool-utils"

const todos = new Map<string, Array<{ content: string; status: "pending" | "in_progress" | "completed" }>>()
export const todoWriteTool: HarnessTool = {
  definition: definition("todowrite", "Maintain a temporary checklist for this chat session (not saved to disk).", { todos: { type: "array", items: { type: "object", properties: { content: { type: "string" }, status: { type: "string", enum: ["pending", "in_progress", "completed"] } }, required: ["content", "status"] } } }, ["todos"]),
  async prepare(value, context) {
    const input = objectArgs(value).todos
    if (!Array.isArray(input) || input.length > 100 || input.some((item) => !item || typeof item !== "object" || typeof item.content !== "string" || item.content.length > 2000 || !["pending", "in_progress", "completed"].includes(String(item.status)))) throw new Error("todos must contain up to 100 { content, status } items with content up to 2,000 characters")
    const request: PermissionRequirement = { tool: "todowrite", action: "update the in-memory todo list", resource: context.sessionId, reason: "This changes the temporary checklist for this chat." }
    const normalized = input.map((item) => ({ content: String(item.content), status: item.status as "pending" | "in_progress" | "completed" }))
    return { permissionRequests: [request], data: normalized }
  },
  async execute(_value, context, prepared) {
    const normalized = prepared as Array<{ content: string; status: "pending" | "in_progress" | "completed" }>
    todos.set(context.sessionId, structuredClone(normalized))
    context.notifyTodoUpdate(normalized)
    return JSON.stringify(todos.get(context.sessionId), null, 2)
  },
}
