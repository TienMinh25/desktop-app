import type { HarnessTool } from "../agent/tool-registry"
import type { LspManager } from "../lsp/lsp-manager"
import type { ResolvedPath } from "../execution/execution-environment"
import type { LspOperation } from "../lsp/types"
import { definition, objectArgs, permissionRequest, stringArg } from "./tool-utils"

export function createLspTool(manager: LspManager): HarnessTool {
  return {
  definition: definition("lsp", "Query a configured language server for definitions, references, hover, or diagnostics. Configure LSP_SERVERS.", { operation: { type: "string", enum: ["definition", "references", "hover", "diagnostics"] }, path: { type: "string" }, line: { type: "number", minimum: 1 }, character: { type: "number", minimum: 1 } }, ["operation", "path"]),
  async prepare(value, context) {
    const args = objectArgs(value)
    const operationValue = stringArg(args, "operation")
    if (!isLspOperation(operationValue)) throw new Error("Unsupported LSP operation")
    const operation = operationValue
    const path = stringArg(args, "path")
    const line = typeof args.line === "number" ? args.line : 1
    const character = typeof args.character === "number" ? args.character : 1
    if (!Number.isInteger(line) || line < 1 || !Number.isInteger(character) || character < 1) throw new Error("line and character must be positive integers")
    const resolved = await context.environment.resolvePath(path)
    return { permissionRequests: [permissionRequest("lsp", "inspect source code", resolved.path, resolved.insideWorkspace)], data: { resolved, operation, line, character } }
  },
  async execute(_value, context, prepared) {
    const { resolved, operation, line, character } = prepared as { resolved: ResolvedPath; operation: LspOperation; line: number; character: number }
    const text = await context.environment.readTextFile(resolved.path, 1_000_000, resolved.insideWorkspace)
    return manager.execute(operation, resolved.path, context.workspacePath, text, line, character)
  },
  }
}

function isLspOperation(value: string): value is LspOperation {
  return value === "definition" || value === "references" || value === "hover" || value === "diagnostics"
}
