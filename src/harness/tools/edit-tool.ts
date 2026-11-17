import type { HarnessTool } from "../agent/tool-registry"
import type { ResolvedPath } from "../execution/execution-environment"
import { definition, objectArgs, permissionRequest, stringArg } from "./tool-utils"

export const editTool: HarnessTool = {
  definition: definition("edit", "Replace matching text in a UTF-8 file. By default the oldString must match exactly once; set replaceAll to replace every occurrence. Requires approval.", {
    path: { type: "string" }, oldString: { type: "string" }, newString: { type: "string" }, replaceAll: { type: "boolean" },
  }, ["path", "oldString", "newString"]),
  async prepare(value, context) {
    const args = objectArgs(value), target = stringArg(args, "path"), oldString = args.oldString
    if (typeof oldString !== "string" || !oldString) throw new Error("oldString must not be empty")
    if (typeof args.newString !== "string") throw new Error("newString must be a string")
    if (args.replaceAll !== undefined && typeof args.replaceAll !== "boolean") throw new Error("replaceAll must be a boolean")
    const resolved = await context.environment.resolvePath(target)
    return { permissionRequests: [permissionRequest("edit", "edit a file", resolved.path, resolved.insideWorkspace)], data: { resolved, oldString, newString: args.newString, replaceAll: args.replaceAll === true } }
  },
  async execute(_value, context, prepared) {
    const { resolved, oldString, newString, replaceAll } = prepared as { resolved: ResolvedPath; oldString: string; newString: string; replaceAll: boolean }
    if (oldString === newString) throw new Error("edit produced no changes")
    const original = await context.environment.readTextFile(resolved.path, Number.MAX_SAFE_INTEGER, resolved.insideWorkspace), first = original.indexOf(oldString)
    if (first < 0) throw new Error("oldString was not found")
    const second = original.indexOf(oldString, first + 1)
    if (!replaceAll && second >= 0) throw new Error("oldString matched more than once; provide a unique match or set replaceAll to true")
    const updated = replaceAll ? original.split(oldString).join(newString) : original.slice(0, first) + newString + original.slice(first + oldString.length)
    if (updated === original) throw new Error("edit produced no changes")
    await context.environment.writeTextFile(resolved.path, updated)
    return `Edited ${resolved.path}`
  },
}
