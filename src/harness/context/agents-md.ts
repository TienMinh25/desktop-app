import type { ExecutionEnvironment } from "../execution/execution-environment"
import { READ_LIMITS } from "../execution/read-limits"
import type { InstructionSection } from "./types"

const AGENTS_MD_FILENAME = "AGENTS.md"
export const AGENTS_MD_MAX_CHARS = 32_000

export interface AgentsMdResult {
  section?: InstructionSection
  warning?: string
}

export type AgentsMdEnvironment = Pick<ExecutionEnvironment, "resolvePath" | "readTextFile">

export async function loadAgentsMd(environment: AgentsMdEnvironment): Promise<AgentsMdResult> {
  try {
    const resolved = await environment.resolvePath(AGENTS_MD_FILENAME)
    if (!resolved.insideWorkspace) {
      return { warning: `Skipped ${AGENTS_MD_FILENAME} because it resolves outside the workspace.` }
    }

    const content = await environment.readTextFile(resolved.path, READ_LIMITS.textFileBytes, true)
    const truncated = content.length > AGENTS_MD_MAX_CHARS
    if (!truncated && !content.trim()) return {}
    return {
      section: {
        kind: "agents_md",
        source: resolved.path,
        text: truncated ? truncateUtf16Safe(content, AGENTS_MD_MAX_CHARS) : content,
      },
      ...(truncated ? { warning: `${AGENTS_MD_FILENAME} exceeded ${AGENTS_MD_MAX_CHARS} characters and was truncated.` } : {}),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return {}
    return { warning: `Could not read ${AGENTS_MD_FILENAME}.` }
  }
}

function truncateUtf16Safe(text: string, maxChars: number): string {
  // Avoid cutting between a high and low UTF-16 surrogate
  const last = text.charCodeAt(maxChars - 1)
  const end = last >= 0xd800 && last <= 0xdbff ? maxChars - 1 : maxChars
  return text.slice(0, end)
}
