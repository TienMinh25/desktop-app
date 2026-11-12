import type { HarnessTool } from "../agent/tool-registry"
import type { ResolvedPath } from "../execution/execution-environment"
import { definition, objectArgs, permissionRequest, stringArg } from "./tool-utils"

export const writeTool: HarnessTool = {
  definition: definition("write", "Create or replace a UTF-8 text file, creating missing parent directories as needed. Requires approval.", { path: { type: "string" }, content: { type: "string" } }, ["path", "content"]),
  async prepare(value, context) {
    const args = objectArgs(value), target = stringArg(args, "path")
    if (typeof args.content !== "string") throw new Error("content must be a string")
    const resolved = await context.environment.resolvePath(target, true)
    if (Buffer.byteLength(args.content, "utf8") > 1_000_000) throw new Error("write content exceeds the 1 MB limit")
    return { permissionRequests: [permissionRequest("write", "create or replace a file", resolved.path, resolved.insideWorkspace)], data: resolved }
  },
  async execute(value, context, prepared) {
    const args = objectArgs(value), resolved = prepared as ResolvedPath
    const content = args.content as string
    await context.environment.writeTextFile(resolved.path, content)
    return `Wrote ${resolved.path} (${content.length} characters)`
  },
}
