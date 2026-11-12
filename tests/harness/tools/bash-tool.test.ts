import { expect, it } from "bun:test"
import { bashTool } from "../../../src/harness/tools/bash-tool"
import { createToolTestContext } from "./tool-test-context"

it("requires approval and runs a shell command in the effective workspace", async () => {
  const testContext = await createToolTestContext()
  try {
    const args = { command: process.platform === "win32" ? "echo harness-ok" : "printf harness-ok" }
    const prepared = await bashTool.prepare!(args, testContext.context)
    expect(prepared.permissionRequests[0]).toMatchObject({ tool: "bash", action: "run a shell command" })
    const result = await bashTool.execute(args, testContext.context, prepared.data)
    expect(result).toContain("stdout:\nharness-ok")
    expect(result).toContain("exit=0")
  } finally { await testContext.cleanup() }
})

it("rejects malformed or oversized shell inputs before process execution", async () => {
  const testContext = await createToolTestContext()
  try {
    await expect(bashTool.prepare!({ command: "x".repeat(20_001) }, testContext.context)).rejects.toThrow("20 KB limit")
    await expect(bashTool.prepare!({ command: "echo ok", timeoutMs: Number.NaN }, testContext.context)).rejects.toThrow("finite number")
  } finally { await testContext.cleanup() }
})

it("enforces the lower timeout bound and reports timeouts", async () => {
  const testContext = await createToolTestContext()
  try {
    const command = process.platform === "win32" ? "ping -n 5 127.0.0.1 > nul" : "sleep 5"
    const args = { command, timeoutMs: 1 }
    const prepared = await bashTool.prepare!(args, testContext.context)
    const result = await bashTool.execute(args, testContext.context, prepared.data)
    expect(result).toContain("Command timed out")
  } finally { await testContext.cleanup() }
})

it("caps each captured shell output stream", async () => {
  const testContext = await createToolTestContext()
  try {
    const command = process.platform === "win32"
      ? `powershell -NoProfile -Command "[Console]::Write('x' * 50000)"`
      : "printf '%050001d' 0"
    const args = { command }
    const prepared = await bashTool.prepare!(args, testContext.context)
    const result = await bashTool.execute(args, testContext.context, prepared.data)
    const stdout = result.split("stdout:\n")[1]?.split("\nstderr:\n")[0] ?? ""
    expect(stdout).toHaveLength(40_000)
  } finally { await testContext.cleanup() }
})
