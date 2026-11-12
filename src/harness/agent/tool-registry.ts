import type { ChatMessage, ChatToolDefinition } from "../../domain/chat/types"
import type { ExecutionEnvironment } from "../execution/execution-environment"
import type { PermissionRequirement } from "../permissions/permission-manager"
import type { UserQuestion } from "../interaction/question-manager"

export interface ToolContext {
  workspacePath: string
  requestId: string
  sessionId: string
  environment: ExecutionEnvironment
  requirePermission(input: PermissionRequirement): Promise<void>
  askUser(input: Omit<UserQuestion, "requestId" | "sessionId">): Promise<string>
  notifyTodoUpdate(todos: Array<{ content: string; status: "pending" | "in_progress" | "completed" }>): void
}

export interface ToolPreparation {
  permissionRequests: PermissionRequirement[]
  data?: unknown
}

export interface HarnessTool {
  definition: ChatToolDefinition
  permissionRequests?(argumentsValue: unknown, context: ToolContext): Promise<PermissionRequirement[]>
  prepare?(argumentsValue: unknown, context: ToolContext): Promise<ToolPreparation>
  execute(argumentsValue: unknown, context: ToolContext, preparedData?: unknown): Promise<string>
}

export class ToolRegistry {
  private readonly tools = new Map<string, HarnessTool>()

  register(tool: HarnessTool) {
    const name = tool.definition.function.name
    if (this.tools.has(name)) throw new Error(`Duplicate tool registration: ${name}`)
    this.tools.set(name, tool)
  }

  definitions(): ChatToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition)
  }

  async execute(name: string, argumentsJson: string, context: ToolContext): Promise<ChatMessage> {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`Unknown tool: ${name}`)
    let args: unknown
    try {
      args = JSON.parse(argumentsJson)
    } catch {
      throw new Error(`Tool ${name} received invalid JSON arguments`)
    }
    for (const request of await tool.permissionRequests?.(args, context) ?? []) await context.requirePermission(request)
    const preparation = await tool.prepare?.(args, context) ?? { permissionRequests: [] }
    for (const request of preparation.permissionRequests) await context.requirePermission(request)
    return { role: "tool", content: await tool.execute(args, context, preparation.data), tool_call_id: "" }
  }
}
