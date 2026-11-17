import { expect, it } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { globalSkillDirectory, skillTool } from "../../../src/harness/tools/skill-tool"
import { createToolTestContext } from "./tool-test-context"

it("lists and loads global skills from the configured global skill directory", async () => {
  const testContext = await createToolTestContext()
  try {
    const skillName = `test-${crypto.randomUUID()}`
    const skillDirectory = join(globalSkillDirectory(), skillName)
    await mkdir(skillDirectory, { recursive: true })
    await writeFile(join(skillDirectory, "SKILL.md"), "Review code carefully.")
    const listArgs = { operation: "list" }
    const listPreparation = await skillTool.prepare!(listArgs, testContext.context)
    try {
      expect(await skillTool.execute(listArgs, testContext.context, listPreparation.data)).toContain(skillName)
      const loadArgs = { operation: "load", name: skillName }
      const permission = await skillTool.permissionRequests!(loadArgs, testContext.context)
      const prepared = await skillTool.prepare!(loadArgs, testContext.context)
      expect(permission[0]).toMatchObject({ tool: "skill", sensitive: true })
      expect(await skillTool.execute(loadArgs, testContext.context, prepared.data)).toContain("Review code carefully.")
    } finally {
      await rm(skillDirectory, { recursive: true, force: true })
    }
  } finally { await testContext.cleanup() }
})

it("rejects invalid operations and reports missing global skills", async () => {
  const testContext = await createToolTestContext()
  try {
    await expect(skillTool.prepare!({ operation: "remove" }, testContext.context)).rejects.toThrow("operation must be list or load")
    await expect(skillTool.prepare!({ operation: "load", name: "missing" }, testContext.context)).rejects.toThrow("Skill not found")
  } finally { await testContext.cleanup() }
})
