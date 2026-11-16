import type { HarnessTool } from "../agent/tool-registry"
import type { LspManager } from "../lsp/lsp-manager"
import type { ResolvedPath } from "../execution/execution-environment"
import type { LspOperation } from "../lsp/types"
import { definition, objectArgs, permissionRequest, stringArg } from "./tool-utils"

export function createLspTool(manager: LspManager): HarnessTool {
  return {
    definition: definition(
      "lsp",
      "Query an enabled language server for definition, references, hover, or diagnostics. The app manages installed servers in Customize → Language Servers. Positions are 1-based and default to line 1, character 1; diagnostics ignores position. Results are JSON capped at 30,000 bytes.",
      {
        operation: { type: "string", enum: ["definition", "references", "hover", "diagnostics"], description: "Language-server operation" },
        path: { type: "string", description: "Workspace-relative or absolute source file path" },
        line: { type: "integer", minimum: 1, description: "1-based line; defaults to 1" },
        character: { type: "integer", minimum: 1, description: "1-based UTF-16 character; defaults to 1" },
      },
      ["operation", "path"],
    ),
    isAvailable: () => manager.isConfigured(),
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
