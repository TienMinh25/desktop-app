import type { HarnessTool } from "../agent/tool-registry"
import type { PermissionRequirement } from "../permissions/permission-manager"
import { definition, objectArgs } from "./tool-utils"
import type { TodoInput, TodoStatus } from "../../contracts/todos"

export const todoWriteTool: HarnessTool = {
  definition: definition("todowrite", "Create or update checklist items for this prompt or selected goal. Reuse an item's id to update it; omitted items stay unchanged.", { todos: { type: "array", items: { type: "object", properties: { id: { type: "string" }, content: { type: "string" }, status: { type: "string", enum: ["pending", "in_progress", "completed"] } }, required: ["content", "status"] } } }, ["todos"]),
  async prepare(value, context) {
    const input = objectArgs(value).todos
    if (!Array.isArray(input) || input.length > 100 || input.some((item) => !item || typeof item !== "object" || ("id" in item && typeof item.id !== "string") || typeof item.content !== "string" || item.content.length > 2000 || !["pending", "in_progress", "completed"].includes(String(item.status)))) throw new Error("todos must contain up to 100 { id?, content, status } items with content up to 2,000 characters")
    const request: PermissionRequirement = { tool: "todowrite", action: "update the in-memory todo list", resource: context.sessionId, reason: "This changes the temporary checklist for this chat." }
    const normalized = input.map((item) => ({ ...(typeof item.id === "string" ? { id: item.id } : {}), content: String(item.content), status: item.status as TodoStatus })) satisfies TodoInput[]
    return { permissionRequests: [request], data: normalized }
  },
  async execute(_value, context, prepared) {
    const snapshot = context.updateTodos(prepared as TodoInput[])
    return JSON.stringify(snapshot, null, 2)
  },
}
