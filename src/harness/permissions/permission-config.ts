import type { PermissionRule } from "./permission-manager"

export interface PermissionConfigResult {
  rules: PermissionRule[]
  error: string | null
}

/** Parses ordered HARNESS_PERMISSION_RULES and fails closed on malformed input. */
export function parsePermissionRules(raw: string | undefined): PermissionConfigResult {
  if (!raw) return { rules: [], error: null }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.some((value) => !isPermissionRule(value))) {
      throw new Error("Expected an array of { tool, pattern, decision } rules")
    }
    return { rules: parsed, error: null }
  } catch (error) {
    return {
      rules: [],
      error: `Invalid HARNESS_PERMISSION_RULES: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function isPermissionRule(value: unknown): value is PermissionRule {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (candidate.tool === "*" || typeof candidate.tool === "string")
    && typeof candidate.pattern === "string"
    && (candidate.decision === "allow" || candidate.decision === "ask" || candidate.decision === "deny")
}
