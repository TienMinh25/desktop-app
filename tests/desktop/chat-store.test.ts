import { expect, it } from "bun:test"
import type { HarnessEvent } from "../../src/contracts/events"
import { useChatStore } from "../../src/desktop/renderer/stores/workspace/chat.store"

it("shows failures before start and keeps the active turn when a queued request fails", () => {
  let emit!: (event: HarnessEvent) => void
  const original = Object.getOwnPropertyDescriptor(globalThis, "window")
  Object.defineProperty(globalThis, "window", { configurable: true, value: { desktop: {
    subscribeHarnessEvents(listener: typeof emit) { emit = listener; return () => {} },
  } } })
  try {
    const store = useChatStore.getState
    store().subscribeHarness()
    const request = { sessionId: "s1", requestId: "a", prompt: "first prompt" }
    emit({ ...request, type: "chat.failed", message: "disk full" })
    expect(store().turns.s1).toMatchObject({ ...request, isStreaming: false, error: "disk full" })

    emit({ ...request, type: "chat.started" })
    const queued = { ...request, requestId: "b", prompt: "second prompt" }
    emit({ ...queued, type: "chat.queued", queuePosition: 1 })
    emit({ ...queued, type: "chat.failed", message: "Session deleted before this prompt started." })
    expect(store().queuedPrompts.s1).toEqual([])
    expect(store().turns.s1).toMatchObject({ ...request, isStreaming: true })

    emit({ ...queued, type: "chat.queued", queuePosition: 1 })
    emit({ type: "harness.exited" })
    expect(store().queuedPrompts).toEqual({})
    expect(store().turns.s1).toMatchObject({
      ...request, isStreaming: false, error: "The harness stopped. Prompts that were waiting were lost.",
    })
  } finally {
    useChatStore.getState().reset()
    if (original) Object.defineProperty(globalThis, "window", original)
    else Reflect.deleteProperty(globalThis, "window")
  }
})
