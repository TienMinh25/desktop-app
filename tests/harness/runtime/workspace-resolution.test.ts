import { mkdtempSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "bun:test"
import type { HarnessEvent } from "../../../src/contracts/events"
import type { ChatModel } from "../../../src/domain/chat/types"
import { ToolRegistry } from "../../../src/harness/agent/tool-registry"
import { LocalExecutionEnvironment } from "../../../src/harness/execution/local-execution-environment"
import { PermissionManager } from "../../../src/harness/permissions/permission-manager"
import { HarnessRuntime, resolveWorkspacePath } from "../../../src/harness/runtime"
import { InMemoryTurnStore } from "../../../src/harness/session/in-memory-turn-store"
import type { BeginTurnInput, FinishTurnInput, TurnHandle } from "../../../src/harness/session/turn-store"

it("runs a prompt from the user's home directory when no workspace was selected", async () => {
  const createdRoots: string[] = []
  const hookRoots: string[] = []
  const events: HarnessEvent[] = []
  let finish!: () => void
  let fail!: (error: Error) => void
  const completed = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject })
  const model: ChatModel = {
    async *stream() {
      yield { type: "text.delta", text: "done" }
      yield { type: "response.output-items", items: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] }] }
      yield { type: "stream.finished" }
    },
  }
  const runtime = new HarnessRuntime({
    turns: new InMemoryTurnStore(1002),
    tools: new ToolRegistry(),
    permissions: new PermissionManager((event) => events.push(event)),
    createChatModel: () => model,
    createExecutionEnvironment(path) {
      createdRoots.push(path)
      return new LocalExecutionEnvironment(path)
    },
    async ensureMcpToolsRegistered(path) { hookRoots.push(path) },
    emit(event) {
      events.push(event)
      if (event.type === "chat.completed") finish()
      if (event.type === "chat.failed") fail(new Error(event.message))
    },
  })

  runtime.submit({ type: "chat.submit", requestId: "r1", sessionId: "s1", prompt: "Create a file", model: "test", approvalMode: "manual" })
  await completed

  expect(createdRoots).toEqual([homedir()])
  expect(hookRoots).toEqual([homedir()])
  expect(events.some((event) => event.type === "assistant.delta" && event.text === "done")).toBe(true)
})

it("normalizes a missing or whitespace-only workspace path to the supplied home root", () => {
  expect(resolveWorkspacePath(undefined, "/Users/example")).toBe("/Users/example")
  expect(resolveWorkspacePath("   ", "/Users/example")).toBe("/Users/example")
})

it("anchors relative workspace paths beneath home and returns an absolute path", () => {
  expect(resolveWorkspacePath("projects/demo", "/Users/example")).toBe(join("/Users/example", "projects/demo"))
})

it("persists each turn's workspace before starting it and completes after the final write", async () => {
  const firstPath = mkdtempSync(join(tmpdir(), "ccodex-first-workspace-"))
  const secondPath = mkdtempSync(join(tmpdir(), "ccodex-second-workspace-"))
  try {
    const order: Array<[string, string, string?]> = []
    class TrackingTurnStore extends InMemoryTurnStore {
      override beginTurn(input: BeginTurnInput) {
        const result = super.beginTurn(input)
        order.push(["begin", result.turn.clientRequestId, result.turn.workspacePath])
        return result
      }

      override finishTurn(turn: TurnHandle, input: FinishTurnInput) {
        super.finishTurn(turn, input)
        order.push(["finish", turn.clientRequestId, this.getTurnMetadata(turn.sessionId, turn.assistantMessageId)?.state])
      }
    }
    let complete!: () => void
    let fail!: (error: Error) => void
    const completed = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject })
    const runtime = new HarnessRuntime({
      turns: new TrackingTurnStore(1002),
      tools: new ToolRegistry(),
      permissions: new PermissionManager(() => {}),
      createChatModel: () => ({ async *stream() {
        yield { type: "response.output-items", items: [{ type: "message", role: "assistant", content: "done" }] }
      } }),
      createExecutionEnvironment: (path) => new LocalExecutionEnvironment(path),
      emit(event) {
        if (event.type === "chat.started" || event.type === "chat.completed") order.push([event.type, event.requestId])
        if (event.type === "chat.completed" && event.requestId === "r2") complete()
        if (event.type === "chat.failed") fail(new Error(event.message))
      },
    })

    const command = { type: "chat.submit", sessionId: "s1", prompt: "Hello", model: "test", approvalMode: "manual" } as const
    runtime.submit({ ...command, requestId: "r1", workspacePath: firstPath })
    runtime.submit({ ...command, requestId: "r2", workspacePath: secondPath })
    await completed

    expect(order).toEqual([
      ["begin", "r1", firstPath], ["chat.started", "r1"], ["finish", "r1", "completed"], ["chat.completed", "r1"],
      ["begin", "r2", secondPath], ["chat.started", "r2"], ["finish", "r2", "completed"], ["chat.completed", "r2"],
    ])
  } finally {
    rmSync(firstPath, { recursive: true, force: true })
    rmSync(secondPath, { recursive: true, force: true })
  }
})
