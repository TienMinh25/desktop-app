import type { HarnessTool } from "../agent/tool-registry"
import type { ResolvedPath } from "../execution/execution-environment"
import { isSensitiveResource } from "../permissions/sensitive-resource"
import { definition, objectArgs, permissionRequest, stringArg } from "./tool-utils"

export const readTool: HarnessTool = {
  definition: definition("read", "Read one page of a UTF-8 text file. Use offset to continue; each page is limited to 2,000 lines and about 50 KB. Files over 20 MB are rejected. Files outside the workspace and sensitive files require approval.", {
    path: { type: "string", description: "Workspace-relative or absolute file path" },
    offset: { type: "integer", minimum: 0, description: "Zero-based line offset; defaults to 0" },
    limit: { type: "integer", minimum: 1, maximum: 2000, description: "Maximum lines to return; defaults to 2,000" },
  }, ["path"]),
  async prepare(value, context) {
    const args = objectArgs(value), requestedPath = stringArg(args, "path")
    const offset = args.offset ?? 0, limit = args.limit ?? 2_000
    if (!Number.isInteger(offset) || (offset as number) < 0) throw new Error("offset must be a non-negative integer")
    if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 2_000) throw new Error("limit must be an integer from 1 to 2,000")
    const resolved = await context.environment.resolvePath(requestedPath)
    const sensitive = isSensitiveResource(resolved.path)
    return { permissionRequests: [permissionRequest("read", "read a file", resolved.path, resolved.insideWorkspace, sensitive)], data: { resolved, offset: offset as number, limit: limit as number } }
  },
  async execute(_value, context, prepared) {
    const { resolved, offset, limit } = prepared as { resolved: ResolvedPath; offset: number; limit: number }
    const page = await context.environment.readTextFilePage(resolved.path, resolved.insideWorkspace, offset, limit)
    if (page.totalLines === 0) return "(empty file)"
    if (!page.content && page.startLine === 0) return `(end of file; ${page.totalLines} lines total)`
    const next = page.nextOffset === undefined ? "end of file" : `next offset: ${page.nextOffset}`
    const total = page.totalLines === undefined ? "" : ` of ${page.totalLines}`
    return `Lines ${page.startLine}-${page.endLine}${total} (${next})\n${page.content}`
  },
}
