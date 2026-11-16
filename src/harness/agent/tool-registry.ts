import type { ChatToolDefinition, FunctionCallOutputItem, ResponseInputContent } from "../../domain/chat/types"
import type { ExecutionEnvironment } from "../execution/execution-environment"
import type { PermissionRequirement } from "../permissions/permission-manager"
import type { UserQuestion } from "../interaction/question-manager"
import type { TodoInput, TodoItem } from "../../contracts/todos"

export interface ToolContext {
  workspacePath: string
  requestId: string
  sessionId: string
  environment: ExecutionEnvironment
  requirePermission(input: PermissionRequirement): Promise<void>
  askUser(input: Omit<UserQuestion, "requestId" | "sessionId">): Promise<string>
  todoScope: { type: "request" | "goal"; id: string }
  updateTodos(items: TodoInput[]): TodoItem[]
}

export interface ToolPreparation {
  permissionRequests: PermissionRequirement[]
  data?: unknown
}

export interface HarnessTool {
  definition: ChatToolDefinition
  /**
   * Request permissions before running prepare. Use this when the preparation
   * step itself must be gated (for example, listing skills or scanning workspace
   * files for sensitive paths). Omit this hook if prepare only validates inputs
   * or resolves safe metadata.
   */
  permissionRequests?(argumentsValue: unknown, context: ToolContext): Promise<PermissionRequirement[]>
  /**
   * Validate arguments and prepare data for execute. May return additional
   * permissions when the resource to authorize can only be identified after
   * safe preparation.
   */
  prepare?(argumentsValue: unknown, context: ToolContext): Promise<ToolPreparation>
  execute(argumentsValue: unknown, context: ToolContext, preparedData?: unknown): Promise<ToolOutput>
}

export type ToolOutput = string | ResponseInputContent[]

export class ToolRegistry {
  private readonly tools = new Map<string, HarnessTool>()

  register(tool: HarnessTool) {
    const name = tool.definition.name
    if (this.tools.has(name)) throw new Error(`Duplicate tool registration: ${name}`)
    this.tools.set(name, tool)
  }

  definitions(): ChatToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition)
  }

  async execute(name: string, argumentsJson: string, context: ToolContext, callId: string): Promise<FunctionCallOutputItem> {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`Unknown tool: ${name}`)
    let args: unknown
    try {
      args = JSON.parse(argumentsJson)
    } catch {
      throw new Error(`Tool ${name} received invalid JSON arguments`)
    }
    // Preflight permissions are requested before prepare; prepare may add
    // permissions based on resolved metadata. Execute runs only after approval.
    for (const request of await tool.permissionRequests?.(args, context) ?? []) await context.requirePermission(request)
    const preparation = await tool.prepare?.(args, context) ?? { permissionRequests: [] }
    for (const request of preparation.permissionRequests) await context.requirePermission(request)
    return { type: "function_call_output", call_id: callId, output: await tool.execute(args, context, preparation.data) }
  }
}
