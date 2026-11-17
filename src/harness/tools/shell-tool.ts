import type { HarnessTool } from "../agent/tool-registry"
import { definition, objectArgs, permissionRequest, stringArg } from "./tool-utils"

export const shellTool: HarnessTool = {
  definition: definition("shell", "Run a shell command in the selected workspace using the available OS shell. Command syntax depends on the selected shell. Defaults to 120 seconds, with a 120-second maximum; returns at most 50,000 output bytes. Requires approval for every command.", { command: { type: "string" }, timeoutMs: { type: "integer", minimum: 1000, maximum: 120000, description: "Optional timeout in milliseconds; defaults to 120,000 and is capped at 120,000" } }, ["command"]),
  async prepare(value) {
    const args = objectArgs(value), command = stringArg(args, "command")
    if (command.length > 20_000) throw new Error("Shell command exceeds the 20 KB limit")
    if (args.timeoutMs !== undefined && (typeof args.timeoutMs !== "number" || !Number.isInteger(args.timeoutMs))) throw new Error("timeoutMs must be an integer")
    return { permissionRequests: [permissionRequest("shell", "run a shell command", command, true)] }
  },
  async execute(value, context) {
    const args = objectArgs(value), command = stringArg(args, "command")
    const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : 120_000
    const result = await context.environment.runCommand(command, timeoutMs)
    return `exit=${result.exitCode ?? result.signal}\nstdout:\n${result.stdout || "(empty)"}\nstderr:\n${result.stderr || "(empty)"}${result.timedOut ? "\nCommand timed out after the configured limit (maximum 120 seconds)." : ""}${result.outputTruncated ? "\n[Output truncated after 50,000 bytes.]" : ""}`
  },
}
