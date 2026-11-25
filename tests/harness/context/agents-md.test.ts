import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  AGENTS_MD_MAX_CHARS,
  loadAgentsMd,
  type AgentsMdEnvironment,
} from "../../../src/harness/context/agents-md"
import { LocalExecutionEnvironment } from "../../../src/harness/execution/local-execution-environment"

const tempDirs: string[] = []

async function createTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agents-md-test-"))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe("loadAgentsMd", () => {
  it("returns no section and no warning when AGENTS.md is missing", async () => {
    const workspace = await createTempWorkspace()
    const env = new LocalExecutionEnvironment(workspace)
    try {
      expect(await loadAgentsMd(env)).toEqual({})
    } finally {
      env.close()
    }
  })

  it("loads a valid AGENTS.md at the workspace root without warnings", async () => {
    const workspace = await createTempWorkspace()
    await writeFile(join(workspace, "AGENTS.md"), "# Rules\nAlways run tests.\n", "utf8")
    const env = new LocalExecutionEnvironment(workspace)
    try {
      const result = await loadAgentsMd(env)
      expect(result.warning).toBeUndefined()
      expect(result.section).toEqual({
        kind: "agents_md",
        source: expect.stringMatching(/AGENTS\.md$/),
        text: "# Rules\nAlways run tests.\n",
      })
    } finally {
      env.close()
    }
  })

  it("truncates AGENTS.md over 32k chars and returns a warning without file content", async () => {
    const workspace = await createTempWorkspace()
    const secretTail = "SECRET_TAIL_SHOULD_NOT_LEAK"
    // Place a surrogate pair across the 32k boundary to verify safe UTF-16 truncation
    const body = `${"a".repeat(AGENTS_MD_MAX_CHARS - 1)}😀${secretTail}`
    await writeFile(join(workspace, "AGENTS.md"), body, "utf8")
    const env = new LocalExecutionEnvironment(workspace)
    try {
      const result = await loadAgentsMd(env)
      expect(result.section?.kind).toBe("agents_md")
      expect(result.section?.text.length).toBe(AGENTS_MD_MAX_CHARS - 1)
      expect(result.section?.text).toBe("a".repeat(AGENTS_MD_MAX_CHARS - 1))
      expect(result.warning).toContain(String(AGENTS_MD_MAX_CHARS))
      expect(result.warning).not.toContain(secretTail)
    } finally {
      env.close()
    }
  })

  it("warns when a whitespace-only AGENTS.md exceeds the character limit", async () => {
    const workspace = await createTempWorkspace()
    await writeFile(join(workspace, "AGENTS.md"), " ".repeat(AGENTS_MD_MAX_CHARS + 1))
    const env = new LocalExecutionEnvironment(workspace)
    try {
      const result = await loadAgentsMd(env)
      expect(result.section?.text.length).toBe(AGENTS_MD_MAX_CHARS)
      expect(result.warning).toContain("truncated")
    } finally {
      env.close()
    }
  })

  it("returns a warning only when AGENTS.md is not valid UTF-8, a directory, escapes workspace, or unreadable", async () => {
    const workspace = await createTempWorkspace()
    const env = new LocalExecutionEnvironment(workspace)
    try {
      await writeFile(join(workspace, "AGENTS.md"), Buffer.from([0xff, 0xfe, 0x00, 0x80]))
      const badUtf8 = await loadAgentsMd(env)
      expect(badUtf8.section).toBeUndefined()
      expect(badUtf8.warning).toContain("AGENTS.md")

      await rm(join(workspace, "AGENTS.md"))
      await mkdir(join(workspace, "AGENTS.md"))
      const asDir = await loadAgentsMd(env)
      expect(asDir.section).toBeUndefined()
      expect(asDir.warning).toContain("AGENTS.md")

      await rm(join(workspace, "AGENTS.md"), { recursive: true })
      const outside = await createTempWorkspace()
      const outsideFile = join(outside, "secret.md")
      await writeFile(outsideFile, "do not read me", "utf8")
      await symlink(outsideFile, join(workspace, "AGENTS.md"))
      const escaped = await loadAgentsMd(env)
      expect(escaped.section).toBeUndefined()
      expect(escaped.warning).toContain("outside the workspace")
      expect(escaped.warning).not.toContain("do not read me")
    } finally {
      env.close()
    }

    const unreadableEnv: AgentsMdEnvironment = {
      async resolvePath() {
        return { path: "/repo/AGENTS.md", insideWorkspace: true }
      },
      async readTextFile() {
        const error = new Error("EACCES: sensitive file content") as NodeJS.ErrnoException
        error.code = "EACCES"
        throw error
      },
    }
    const unreadable = await loadAgentsMd(unreadableEnv)
    expect(unreadable.section).toBeUndefined()
    expect(unreadable.warning).toContain("Could not read AGENTS.md")
    expect(unreadable.warning).not.toContain("sensitive file content")
  })
})
