import type { HarnessTool } from "../agent/tool-registry"
import { definition, objectArgs, permissionRequest, stringArg } from "./tool-utils"

export const applyPatchTool: HarnessTool = {
  definition: definition("apply_patch", "Apply an OpenCode-style multi-file patch with add, update, delete, and move operations. Requires approval.", { patchText: { type: "string" } }, ["patchText"]),
  async prepare(value, context) {
    const patchText = stringArg(objectArgs(value), "patchText")
    const paths = context.environment.validatePatch(patchText)
    for (const path of paths) {
      const resolved = await context.environment.resolvePath(path, true)
      if (!resolved.insideWorkspace) throw new Error(`Patch path escapes workspace: ${path}`)
    }
    return { permissionRequests: [permissionRequest("apply_patch", "apply a source patch to", paths.join(", "), true)], data: patchText }
  },
  execute(_value, context, prepared) {
    return context.environment.applyPatch(prepared as string)
  },
}
