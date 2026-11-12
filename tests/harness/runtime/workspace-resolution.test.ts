import { homedir } from "node:os"
import { join } from "node:path"
import { expect, it } from "bun:test"
import type { HarnessEvent } from "../../../src/contracts/events"
import type { ChatModel } from "../../../src/domain/chat/types"
import { LocalExecutionEnvironment } from "../../../src/harness/execution/local-execution-environment"
import { PermissionManager } from "../../../src/harness/permissions/permission-manager"
import { HarnessRuntime, resolveWorkspacePath } from "../../../src/harness/runtime"
import { InMemoryConversationStore } from "../../../src/harness/session/in-memory-conversation-store"
import { ToolRegistry } from "../../../src/harness/agent/tool-registry"

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
      yield { type: "stream.finished" }
    },
  }
  const runtime = new HarnessRuntime({
    conversations: new InMemoryConversationStore(),
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
