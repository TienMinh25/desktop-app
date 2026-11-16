import { expect, it } from "bun:test"
import { shellTool } from "../../../src/harness/tools/shell-tool"
import { createToolTestContext } from "./tool-test-context"

it("uses the shell tool identifier, requires approval, and runs in the effective workspace", async () => {
  const testContext = await createToolTestContext()
  try {
    const args = { command: process.platform === "win32" ? "echo harness-ok" : "printf harness-ok" }
    expect(shellTool.definition.name).toBe("shell")
    const prepared = await shellTool.prepare!(args, testContext.context)
    expect(prepared.permissionRequests[0]).toMatchObject({ tool: "shell", action: "run a shell command" })
    const result = await shellTool.execute(args, testContext.context, prepared.data)
    expect(result).toContain("stdout:\nharness-ok")
    expect(result).toContain("exit=0")
  } finally { await testContext.cleanup() }
})

it("rejects malformed or oversized shell inputs before process execution", async () => {
  const testContext = await createToolTestContext()
  try {
    await expect(shellTool.prepare!({ command: "x".repeat(20_001) }, testContext.context)).rejects.toThrow("20 KB limit")
    await expect(shellTool.prepare!({ command: "echo ok", timeoutMs: Number.NaN }, testContext.context)).rejects.toThrow("must be an integer")
  } finally { await testContext.cleanup() }
})

it("enforces the lower timeout bound and reports timeouts", async () => {
  const testContext = await createToolTestContext()
  try {
    const command = process.platform === "win32" ? "ping -n 5 127.0.0.1 > nul" : "sleep 5"
    const args = { command, timeoutMs: 1 }
    const prepared = await shellTool.prepare!(args, testContext.context)
    const result = await shellTool.execute(args, testContext.context, prepared.data)
    expect(result).toContain("Command timed out")
  } finally { await testContext.cleanup() }
})

it("caps combined stdout and stderr at 50,000 bytes", async () => {
  const testContext = await createToolTestContext()
  try {
    const command = process.platform === "win32"
      ? `powershell -NoProfile -Command "[Console]::Out.Write('x' * 30000); [Console]::Error.Write('y' * 30000)"`
      : "printf '%030000d' 0; printf '%030000d' 0 >&2"
    const args = { command }
    const prepared = await shellTool.prepare!(args, testContext.context)
    const result = await shellTool.execute(args, testContext.context, prepared.data)
    expect(typeof result).toBe("string")
    if (typeof result !== "string") throw new Error("Expected shell output to be text")
    const stdout = result.split("stdout:\n")[1]?.split("\nstderr:\n")[0] ?? ""
    const stderr = result.split("stderr:\n")[1]?.split("\n[Output truncated")[0] ?? ""
    expect(Buffer.byteLength(stdout) + Buffer.byteLength(stderr)).toBe(50_000)
  } finally { await testContext.cleanup() }
})
