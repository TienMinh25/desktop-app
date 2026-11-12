import type { HarnessTool } from "../agent/tool-registry"
import { definition, objectArgs, permissionRequest, stringArg } from "./tool-utils"

export const applyPatchTool: HarnessTool = {
  definition: definition("apply_patch", "Apply a unified git diff in the selected workspace. Requires approval.", { patch: { type: "string" } }, ["patch"]),
  async prepare(value, context) {
    const patch = stringArg(objectArgs(value), "patch")
    const paths = context.environment.validatePatch(patch)
    return { permissionRequests: [permissionRequest("apply_patch", "apply a source patch to", paths.join(", "), true)], data: patch }
  },
  execute(_value, context, prepared) {
    const patch = prepared as string
    return context.environment.applyPatch(patch)
  },
}
