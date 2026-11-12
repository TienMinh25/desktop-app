import { HARNESS_EVENT_TYPES, type HarnessEvent } from "../../contracts/events"
import type { ApprovalMode } from "../../contracts/permissions"
import { isSensitiveResource } from "./sensitive-resource"

export type PermissionDecision = "allow" | "ask" | "deny"

export interface PermissionRequest {
  requestId: string
  sessionId: string
  tool: string
  action: string
  resource: string
  reason: string
  outsideWorkspace?: boolean
  sensitive?: boolean
}

/** Tool-level permission intent before request/session IDs are attached by the runtime. */
export type PermissionRequirement = Omit<PermissionRequest, "requestId" | "sessionId">

export interface PermissionRule {
  tool: string | "*"
  pattern: string
  decision: PermissionDecision
}

interface PendingPermission {
  resolve: (allowed: boolean) => void
  timer: ReturnType<typeof setTimeout>
}

/** Combines internal allow/ask/deny policy with the user's per-turn approval mode. */
export class PermissionManager {
  private readonly pending = new Map<string, PendingPermission>()
  private readonly defaults: Readonly<Record<string, PermissionDecision>> = {
    read: "allow", write: "ask", edit: "ask", glob: "allow", grep: "allow",
    bash: "ask", apply_patch: "ask", lsp: "ask", webfetch: "ask", todowrite: "allow", skill: "ask", mcp: "ask",
  }

  constructor(
    private readonly emit: (event: HarnessEvent) => void,
    private readonly rules: readonly PermissionRule[] = [],
  ) {}

  respond(permissionRequestId: string, decision: "allow" | "deny"): void {
    const pending = this.pending.get(permissionRequestId)
    if (!pending) return
    this.pending.delete(permissionRequestId)
    clearTimeout(pending.timer)
    pending.resolve(decision === "allow")
  }

  async request(request: PermissionRequest, mode: ApprovalMode): Promise<void> {
    const policyDecision = this.policyDecision(request)
    if (policyDecision === "deny") throw new Error(`Permission denied by policy: ${request.tool}`)

    const requiresUserApproval = mode === "manual"
      || (mode === "auto-safe" && policyDecision === "ask")
    if (!requiresUserApproval) return

    const permissionRequestId = crypto.randomUUID()
    const allowed = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(permissionRequestId)
        this.emit({ type: HARNESS_EVENT_TYPES.PERMISSION_EXPIRED, requestId: request.requestId, sessionId: request.sessionId, permissionRequestId })
        resolve(false)
      }, 5 * 60_000)
      this.pending.set(permissionRequestId, { resolve, timer })
      this.emit({ type: HARNESS_EVENT_TYPES.PERMISSION_REQUIRED, ...request, permissionRequestId })
    })
    if (!allowed) throw new Error(`Permission denied for ${request.tool}: ${request.resource}`)
  }

  private policyDecision(request: PermissionRequest): PermissionDecision {
    let decision = this.defaults[request.tool] ?? "deny"
    if (request.outsideWorkspace || request.sensitive || (request.tool === "read" && isSensitiveResource(request.resource))) decision = "ask"
    for (const rule of this.rules) {
      if ((rule.tool === "*" || rule.tool === request.tool) && wildcardMatches(rule.pattern, request.resource)) decision = rule.decision
    }
    return decision
  }
}

function wildcardMatches(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")
  return new RegExp(`^${escaped}$`, "i").test(value)
}
