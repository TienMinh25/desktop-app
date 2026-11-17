import type { HarnessTool } from "../agent/tool-registry"
import type { FileListResult } from "../execution/execution-environment"
import { isSensitiveResource } from "../permissions/sensitive-resource"
import { definition, objectArgs, permissionRequest, stringArg } from "./tool-utils"

export const grepTool: HarnessTool = {
  definition: definition("grep", "Search UTF-8 text files in the workspace with a ripgrep regular expression.", { pattern: { type: "string" }, glob: { type: "string" }, caseSensitive: { type: "boolean" } }, ["pattern"]),
  async permissionRequests(value) {
    const pattern = stringArg(objectArgs(value), "pattern")
    if (pattern.length > 500) throw new Error("Search pattern is limited to 500 characters")
    return [permissionRequest("grep", "search workspace files for", pattern, true)]
  },
  async prepare(value, context) {
    const args = objectArgs(value), pattern = stringArg(args, "pattern")
    if (pattern.length > 500) throw new Error("Search pattern is limited to 500 characters")
    const filePattern = typeof args.glob === "string" ? args.glob : "**/*"
    if (filePattern.length > 1_000) throw new Error("Glob pattern is limited to 1,000 characters")
    if (filePattern.replaceAll("\\", "/").split("/").includes("..")) throw new Error("Glob patterns must stay inside the workspace")
    if (args.caseSensitive !== undefined && typeof args.caseSensitive !== "boolean") throw new Error("caseSensitive must be a boolean")
    const files = await context.environment.listFiles(filePattern, 20_000)
    const permissionRequests = []
    const sensitivePaths = files.files.filter((file) => isSensitiveResource(file.absolutePath)).map((file) => file.absolutePath)
    if (sensitivePaths.length) permissionRequests.push(permissionRequest("grep", "search potentially sensitive files", sensitivePaths.join(", "), true, true))
    if (files.truncated) permissionRequests.push(permissionRequest("grep", "search the workspace because sensitive-file preflight reached its limit", context.workspacePath, true, true))
    return { permissionRequests, data: files }
  },
  async execute(value, context, prepared) {
    const args = objectArgs(value), pattern = stringArg(args, "pattern")
    const filePattern = typeof args.glob === "string" ? args.glob : "**/*"
    const files = prepared as FileListResult
    const candidatePaths = files.truncated ? undefined : files.files.map((file) => file.relativePath)
    const result = await context.environment.searchText(pattern, filePattern, 500, args.caseSensitive === true, candidatePaths)
    const output = result.matches.map((match) => `${match.path}:${match.line}: ${match.text.slice(0, 1000)}`)
    return `${output.length ? output.join("\n") : "No matches"}${files.truncated || result.truncated ? "\n[search was capped by workspace limits]" : ""}`
  },
}
