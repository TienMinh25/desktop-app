import type { HarnessTool } from "../agent/tool-registry"
import { globToRegExp } from "../execution/path-pattern"
import { definition, objectArgs, permissionRequest, stringArg } from "./tool-utils"

export const globTool: HarnessTool = {
  definition: definition("glob", "List workspace files matching a simple glob pattern (*, **, ?).", { pattern: { type: "string" } }, ["pattern"]),
  async prepare(value, context) {
    const pattern = stringArg(objectArgs(value), "pattern")
    globToRegExp(pattern)
    return { permissionRequests: [permissionRequest("glob", "list matching workspace files for", pattern, true)] }
  },
  async execute(value, context) {
    const pattern = stringArg(objectArgs(value), "pattern")
    const result = await context.environment.listFiles(pattern, 500)
    return `${result.files.length ? result.files.map((file) => file.relativePath).join("\n") : "No matches"}${result.truncated ? "\n[search results were capped]" : ""}`
  },
}
