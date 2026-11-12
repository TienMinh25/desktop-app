import { expect, it } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { skillTool } from "../../../src/harness/tools/skill-tool"
import { createToolTestContext } from "./tool-test-context"

it("lists and loads project skills from a known project skill directory", async () => {
  const testContext = await createToolTestContext()
  try {
    const skillDirectory = join(testContext.context.workspacePath, ".agents", "skills", "review")
    await mkdir(skillDirectory, { recursive: true })
    await writeFile(join(skillDirectory, "SKILL.md"), "Review code carefully.")
    const listArgs = { operation: "list" }
    const listPreparation = await skillTool.prepare!(listArgs, testContext.context)
    expect(await skillTool.execute(listArgs, testContext.context, listPreparation.data)).toContain("review")
    const loadArgs = { operation: "load", name: "review" }
    const permission = await skillTool.permissionRequests!(loadArgs, testContext.context)
    const prepared = await skillTool.prepare!(loadArgs, testContext.context)
    expect(permission[0]).toMatchObject({ tool: "skill", sensitive: true })
    expect(await skillTool.execute(loadArgs, testContext.context, prepared.data)).toContain("Review code carefully.")
  } finally { await testContext.cleanup() }
})

it("rejects invalid operations and reports missing project skills", async () => {
  const testContext = await createToolTestContext()
  try {
    await expect(skillTool.prepare!({ operation: "remove" }, testContext.context)).rejects.toThrow("operation must be list or load")
    await expect(skillTool.prepare!({ operation: "load", name: "missing" }, testContext.context)).rejects.toThrow("Skill not found")
  } finally { await testContext.cleanup() }
})
