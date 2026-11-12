import { lstat, mkdir, readdir, realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { join, sep } from "node:path"
import type { HarnessTool } from "../agent/tool-registry"
import { definition, objectArgs, permissionRequest, stringArg } from "./tool-utils"

export function globalSkillDirectory() {
  return join(homedir(), ".ccodex", "skills")
}

export async function ensureGlobalSkillDirectory() {
  const directory = globalSkillDirectory()
  await mkdir(directory, { recursive: true })
  const codexDirectory = join(homedir(), ".ccodex")
  if ((await lstat(codexDirectory)).isSymbolicLink() || (await lstat(directory)).isSymbolicLink()) {
    throw new Error("The global .ccodex/skills directory must not contain symbolic links")
  }
  const actual = await realpath(directory)
  return actual
}

async function discoverSkills() {
  const root = await ensureGlobalSkillDirectory()
  const skills: Array<{ name: string; path: string }> = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.name)) continue
    const path = join(root, entry.name, "SKILL.md")
    try {
      const info = await lstat(path)
      if (!info.isFile()) continue
      const actual = await realpath(path)
      if (!actual.startsWith(`${root}${sep}`)) continue
      skills.push({ name: entry.name, path: actual })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name))
}

export const skillTool: HarnessTool = {
  definition: definition("skill", "List or load a skill from the user's global ~/.ccodex/skills/<name>/SKILL.md directory. Loading adds instructions to the model context and requires approval.", {
    operation: { type: "string", enum: ["list", "load"] },
    name: { type: "string", description: "Skill folder name, required for load" },
  }, ["operation"]),
  async permissionRequests(value) {
    const args = objectArgs(value), operation = stringArg(args, "operation")
    const root = await ensureGlobalSkillDirectory()
    if (operation === "list") return [permissionRequest("skill", "list global skills under", root, false)]
    if (operation === "load") {
      const name = stringArg(args, "name")
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error("Invalid skill name")
      const path = join(root, name, "SKILL.md")
      return [permissionRequest("skill", "load global skill", path, false, true, "Skill instructions from ~/.ccodex will be added to the model context; review them before loading.")]
    }
    throw new Error("operation must be list or load")
  },
  async prepare(value) {
    const args = objectArgs(value), operation = stringArg(args, "operation")
    if (operation !== "list" && operation !== "load") throw new Error("operation must be list or load")
    if (operation === "list") return { permissionRequests: [] }
    const name = stringArg(args, "name")
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error("Invalid skill name")
    const skill = (await discoverSkills()).find((item) => item.name === name)
    if (!skill) throw new Error(`Skill not found in ~/.ccodex/skills: ${name}`)
    return { permissionRequests: [], data: skill }
  },
  async execute(value, context, prepared) {
    const operation = stringArg(objectArgs(value), "operation")
    if (operation === "list") {
      const skills = await discoverSkills()
      return skills.map((item) => item.name).join("\n") || "No global skills found in ~/.ccodex/skills"
    }
    const skill = prepared as { name: string; path: string }
    const content = await context.environment.readTextFile(skill.path, 100_000, false)
    return `Loaded global skill ${skill.name} from ${skill.path}\n\n${content}`
  },
}
