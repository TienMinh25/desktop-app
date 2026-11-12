import { expect, it } from "bun:test"
import { parsePermissionRules } from "../../../src/harness/permissions/permission-config"

it("uses no custom permission rules when no configuration was provided", () => {
  expect(parsePermissionRules(undefined)).toEqual({ rules: [], error: null })
})

it("preserves a validated ordered rule list", () => {
  expect(parsePermissionRules('[{"tool":"bash","pattern":"git status*","decision":"allow"}]')).toEqual({
    rules: [{ tool: "bash", pattern: "git status*", decision: "allow" }],
    error: null,
  })
})

it("fails closed for malformed or invalid permission rules", () => {
  expect(parsePermissionRules("not json").rules).toEqual([])
  expect(parsePermissionRules("not json").error).toContain("Invalid HARNESS_PERMISSION_RULES")
  expect(parsePermissionRules('[{"tool":"bash","pattern":"*","decision":"approve"}]').rules).toEqual([])
  expect(parsePermissionRules('[{"tool":"bash","pattern":"*","decision":"approve"}]').error).toContain("Invalid HARNESS_PERMISSION_RULES")
})
