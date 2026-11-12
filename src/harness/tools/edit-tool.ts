import type { HarnessTool } from "../agent/tool-registry"
import type { ResolvedPath } from "../execution/execution-environment"
import { definition, objectArgs, permissionRequest, stringArg } from "./tool-utils"

export const editTool: HarnessTool = {
  definition: definition("edit", "Replace one exact text occurrence in a UTF-8 file. Requires approval.", { path: { type: "string" }, oldText: { type: "string" }, newText: { type: "string" } }, ["path", "oldText", "newText"]),
  async prepare(value, context) {
    const args = objectArgs(value), target = stringArg(args, "path"), oldText = stringArg(args, "oldText")
    if (typeof args.newText !== "string") throw new Error("newText must be a string")
    const resolved = await context.environment.resolvePath(target)
    return { permissionRequests: [permissionRequest("edit", "edit a file", resolved.path, resolved.insideWorkspace)], data: { resolved, oldText, newText: args.newText } }
  },
  async execute(_value, context, prepared) {
    const { resolved, oldText, newText } = prepared as { resolved: ResolvedPath; oldText: string; newText: string }
    const original = await context.environment.readTextFile(resolved.path, 1_000_000, resolved.insideWorkspace), first = original.indexOf(oldText)
    if (first < 0) throw new Error("oldText was not found")
    if (original.indexOf(oldText, first + oldText.length) >= 0) throw new Error("oldText matched more than once; provide a unique match")
    const updated = original.slice(0, first) + newText + original.slice(first + oldText.length)
    if (Buffer.byteLength(updated, "utf8") > 1_000_000) throw new Error("edited file exceeds the 1 MB limit")
    await context.environment.writeTextFile(resolved.path, updated)
    return `Edited ${resolved.path}`
  },
}
