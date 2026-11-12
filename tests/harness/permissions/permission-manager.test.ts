import { describe, expect, it } from "bun:test"
import { PermissionManager } from "../../../src/harness/permissions/permission-manager"
import type { HarnessEvent } from "../../../src/contracts/events"

const request = {
  requestId: "request-1",
  sessionId: "session-1",
  tool: "read",
  action: "read",
  resource: "/workspace/src/index.ts",
  reason: "Read source file",
}

describe("PermissionManager approval modes", () => {
  it("asks the user for every non-denied operation in manual mode", async () => {
    const events: HarnessEvent[] = []
    const manager = new PermissionManager((event) => events.push(event))
    const result = manager.request(request, "manual")

    expect(events[0]?.type).toBe("permission.required")
    if (events[0]?.type !== "permission.required") throw new Error("Expected permission.required")
    manager.respond(events[0].permissionRequestId, "allow")
    await expect(result).resolves.toBeUndefined()
  })

  it("automatically allows safe policy decisions but still asks for risky operations", async () => {
    const safeEvents: HarnessEvent[] = []
    const safe = new PermissionManager((event) => safeEvents.push(event))
    await expect(safe.request(request, "auto-safe")).resolves.toBeUndefined()
    expect(safeEvents).toHaveLength(0)

    const riskyEvents: HarnessEvent[] = []
    const risky = new PermissionManager((event) => riskyEvents.push(event))
    const result = risky.request({ ...request, tool: "write", action: "write" }, "auto-safe")
    expect(riskyEvents[0]?.type).toBe("permission.required")
    if (riskyEvents[0]?.type !== "permission.required") throw new Error("Expected permission.required")
    risky.respond(riskyEvents[0].permissionRequestId, "allow")
    await expect(result).resolves.toBeUndefined()
  })

  it("keeps asking for sensitive and out-of-workspace reads in auto-safe mode", async () => {
    for (const requestOverride of [{ sensitive: true }, { outsideWorkspace: true }]) {
      const events: HarnessEvent[] = []
      const manager = new PermissionManager((event) => events.push(event))
      const result = manager.request({ ...request, ...requestOverride }, "auto-safe")
      const permissionEvent = events.find((event) => event.type === "permission.required")
      expect(permissionEvent?.type).toBe("permission.required")
      if (permissionEvent?.type !== "permission.required") throw new Error("Expected permission.required")
      manager.respond(permissionEvent.permissionRequestId, "deny")
      await expect(result).rejects.toThrow("Permission denied for read")
    }
  })

  it("asks before reading common credential files inside the home workspace", async () => {
    for (const resource of [
      "/Users/tienminh/.ssh/id_ed25519",
      "/Users/tienminh/.aws/credentials",
      "/Users/tienminh/.kube/config",
      "/Users/tienminh/.docker/config.json",
      "/Users/tienminh/.config/gcloud/application_default_credentials.json",
    ]) {
      const events: HarnessEvent[] = []
      const manager = new PermissionManager((event) => events.push(event))
      const result = manager.request({ ...request, resource }, "auto-safe")
      const permissionEvent = events.find((event) => event.type === "permission.required")
      expect(permissionEvent?.type).toBe("permission.required")
      if (permissionEvent?.type !== "permission.required") throw new Error("Expected sensitive read approval")
      manager.respond(permissionEvent.permissionRequestId, "deny")
      await expect(result).rejects.toThrow("Permission denied for read")
    }
  })

  it("automatically approves ask decisions in full-access mode but keeps explicit deny rules", async () => {
    const events: HarnessEvent[] = []
    const manager = new PermissionManager((event) => events.push(event), [
      { tool: "write", pattern: "**/*", decision: "deny" },
    ])

    await expect(manager.request({ ...request, tool: "edit", action: "edit" }, "full-access")).resolves.toBeUndefined()
    expect(events).toHaveLength(0)
    await expect(manager.request({ ...request, tool: "write", action: "write" }, "full-access")).rejects.toThrow("Permission denied by policy")
  })

  it("keeps ordered policy rules as the source of allow, ask, and deny decisions", async () => {
    const events: HarnessEvent[] = []
    const manager = new PermissionManager((event) => events.push(event), [
      { tool: "read", pattern: "**/*", decision: "deny" },
      { tool: "read", pattern: "**/index.ts", decision: "allow" },
    ])

    await expect(manager.request(request, "auto-safe")).resolves.toBeUndefined()
    expect(events).toHaveLength(0)
  })
})
