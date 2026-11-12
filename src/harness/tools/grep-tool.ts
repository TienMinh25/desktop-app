import type { HarnessTool } from "../agent/tool-registry"
import type { FileListResult } from "../execution/execution-environment"
import { globToRegExp } from "../execution/path-pattern"
import { isSensitiveResource } from "../permissions/sensitive-resource"
import { definition, objectArgs, permissionRequest, stringArg } from "./tool-utils"

export const grepTool: HarnessTool = {
  definition: definition("grep", "Search UTF-8 text files in the workspace with a regular expression.", { pattern: { type: "string" }, glob: { type: "string" } }, ["pattern"]),
  async permissionRequests(value) {
    const pattern = stringArg(objectArgs(value), "pattern")
    if (pattern.length > 500) throw new Error("Search pattern is limited to 500 characters")
    new RegExp(pattern, "i")
    return [permissionRequest("grep", "search workspace files for", pattern, true)]
  },
  async prepare(value, context) {
    const args = objectArgs(value), pattern = stringArg(args, "pattern")
    if (pattern.length > 500) throw new Error("Search pattern is limited to 500 characters")
    if (/\([^)]*(?:\+|\*|\|)[^)]*\)(?:\+|\*|\{)/.test(pattern)) throw new Error("Nested or repeated regex groups are disabled for workspace search")
    new RegExp(pattern, "i")
    const filePattern = typeof args.glob === "string" ? args.glob : "**/*"
    globToRegExp(filePattern)
    const files = await context.environment.listFiles(filePattern, 20_000)
    const permissionRequests = []
    const sensitivePaths = files.files.filter((file) => isSensitiveResource(file.absolutePath)).map((file) => file.absolutePath)
    if (sensitivePaths.length) permissionRequests.push(permissionRequest("grep", "search potentially sensitive files", sensitivePaths.join(", "), true, true))
    return { permissionRequests, data: files }
  },
  async execute(value, context, prepared) {
    const args = objectArgs(value), pattern = stringArg(args, "pattern")
    const filePattern = typeof args.glob === "string" ? args.glob : "**/*"
    const files = prepared as FileListResult
    const result = await context.environment.searchText(pattern, filePattern, 500)
    const output = result.matches.map((match) => {
      const [path, line, ...content] = match.split(":")
      return `${path}:${line}: ${content.join(":").slice(0, 1000)}`
    })
    return `${output.length ? output.join("\n") : "No matches"}${files.truncated || result.truncated ? "\n[search was capped by workspace limits]" : ""}`
  },
}
