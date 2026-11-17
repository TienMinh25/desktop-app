import type { PermissionRule } from "./permission-manager"
import { z } from "zod"

export interface PermissionConfigResult {
  rules: PermissionRule[]
  error: string | null
}

const PermissionRuleSchema = z.object({
  tool: z.union([z.literal("*"), z.string()]),
  pattern: z.string(),
  decision: z.enum(["allow", "ask", "deny"]),
}).passthrough()

const PermissionRulesSchema = z.array(PermissionRuleSchema)

/** Validates ordered HARNESS_PERMISSION_RULES and fails closed on malformed input. */
export function parsePermissionRules(raw: string | undefined): PermissionConfigResult {
  if (!raw) return { rules: [], error: null }
  try {
    const parsed: unknown = JSON.parse(raw)
    const result = PermissionRulesSchema.safeParse(parsed)
    if (!result.success) {
      throw new Error(result.error.issues[0]?.message ?? "Expected an array of { tool, pattern, decision } rules")
    }
    return { rules: result.data as PermissionRule[], error: null }
  } catch (error) {
    return {
      rules: [],
      error: `Invalid HARNESS_PERMISSION_RULES: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
