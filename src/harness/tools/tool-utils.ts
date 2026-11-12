import type { PermissionRequirement } from "../permissions/permission-manager"

export function objectArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Tool arguments must be an object")
  return value as Record<string, unknown>
}

export function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== "string" || !value) throw new Error(`${key} must be a non-empty string`)
  return value
}

export function permissionRequest(tool: string, action: string, resource: string, insideWorkspace: boolean, sensitive = false, reasonOverride?: string): PermissionRequirement {
  return { tool, action, resource, outsideWorkspace: !insideWorkspace, sensitive, reason: reasonOverride ?? (sensitive ? "This resource may contain credentials or private configuration." : insideWorkspace ? `The ${tool} tool will ${action} this workspace resource.` : "This resource is outside the selected workspace.") }
}

export function definition(name: string, description: string, properties: Record<string, unknown>, required: string[]) {
  return { type: "function" as const, function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } } }
}
