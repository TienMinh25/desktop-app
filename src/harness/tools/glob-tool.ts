import type { HarnessTool } from "../agent/tool-registry"
import { definition, objectArgs, permissionRequest, stringArg } from "./tool-utils"

export const globTool: HarnessTool = {
  definition: definition("glob", "List workspace files matching ripgrep glob syntax.", { pattern: { type: "string" } }, ["pattern"]),
  async prepare(value) {
    const pattern = stringArg(objectArgs(value), "pattern")
    if (pattern.length > 1_000) throw new Error("Glob pattern is limited to 1,000 characters")
    if (pattern.replaceAll("\\", "/").split("/").includes("..")) throw new Error("Glob patterns must stay inside the workspace")
    return { permissionRequests: [permissionRequest("glob", "list matching workspace files for", pattern, true)] }
  },
  async execute(value, context) {
    const pattern = stringArg(objectArgs(value), "pattern")
    const result = await context.environment.listFiles(pattern, 500)
    return `${result.files.length ? result.files.map((file) => file.relativePath).join("\n") : "No matches"}${result.truncated ? "\n[search results were capped]" : ""}`
  },
}
