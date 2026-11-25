import { expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import type { UtilityProcess } from "electron"
import { HARNESS_EVENT_TYPES } from "../../src/contracts/message-types"
import { HarnessLifecycle } from "../../src/desktop/main/harness-lifecycle"

class FakeHarness extends EventEmitter {
  killCount = 0

  kill() {
    this.killCount++
    return false
  }

  ready() {
    this.emit("message", { type: HARNESS_EVENT_TYPES.HARNESS_READY })
  }
}

function setup(readyTimeoutMs = 1_000, stopTimeoutMs = 1_000, configure = async () => {}) {
  const children: FakeHarness[] = []
  const messages: unknown[] = []
  let unexpectedExits = 0
  const lifecycle = new HarnessLifecycle({
    fork() {
      const child = new FakeHarness()
      children.push(child)
      return child as unknown as UtilityProcess
    },
    configure,
    onMessage: (_child, message) => { messages.push(message) },
    onUnexpectedExit: () => { unexpectedExits++ },
    readyTimeoutMs,
    stopTimeoutMs,
  })
  return { lifecycle, children, messages, get unexpectedExits() { return unexpectedExits } }
}

test("concurrent starts share a child and wait for readiness and configuration", async () => {
  const configuration = Promise.withResolvers<void>()
  const { lifecycle, children } = setup(1_000, 1_000, () => configuration.promise)
  const first = lifecycle.ensure()
  const second = lifecycle.ensure()
  await Promise.resolve()
  expect(children).toHaveLength(1)
  expect(lifecycle.readyProcess).toBeNull()
  children[0]!.ready()
  await Promise.resolve()
  expect(lifecycle.readyProcess).toBeNull()
  configuration.resolve()
  expect(await first).toBe(children[0] as unknown as UtilityProcess)
  expect(await second).toBe(await first)
  expect(children).toHaveLength(1)
})

test("an exit before readiness rejects startup and allows a replacement", async () => {
  const state = setup()
  const first = state.lifecycle.ensure()
  await Promise.resolve()
  state.children[0]!.emit("exit", 1)
  await expect(first).rejects.toThrow("exited before becoming ready")
  expect(state.unexpectedExits).toBe(1)
  expect(state.lifecycle.alive).toBe(false)

  const retry = state.lifecycle.ensure()
  await Promise.resolve()
  state.children[1]!.ready()
  await retry
  expect(state.children[0]!.killCount).toBe(0)
  expect(state.lifecycle.alive).toBe(true)
})

test("a readiness timeout keeps the old process tracked until its exit", async () => {
  const state = setup(5, 5)
  const startup = state.lifecycle.ensure()
  await expect(startup).rejects.toThrow("did not become ready")
  expect(state.children[0]!.killCount).toBe(1)
  expect(state.lifecycle.alive).toBe(true)
  expect(state.lifecycle.readyProcess).toBeNull()
  state.children[0]!.ready()
  state.children[0]!.emit("message", "late event")
  expect(state.messages).toEqual([])
  await expect(state.lifecycle.ensure()).rejects.toThrow("still stopping")
  expect(state.children).toHaveLength(1)

  state.children[0]!.emit("exit", 0)
  expect(state.unexpectedExits).toBe(0)
  expect(state.lifecycle.alive).toBe(false)
  const retry = state.lifecycle.ensure()
  await Promise.resolve()
  state.children[1]!.ready()
  await retry
  expect(state.children).toHaveLength(2)
})

test("stop waits for exit even when the kill request fails", async () => {
  const state = setup()
  const startup = state.lifecycle.ensure()
  await Promise.resolve()
  state.children[0]!.ready()
  await startup
  const stopped = state.lifecycle.stop()
  const restarted = state.lifecycle.ensure()
  await Promise.resolve()
  expect(state.children[0]!.killCount).toBe(1)
  expect(state.lifecycle.alive).toBe(true)
  expect(state.lifecycle.readyProcess).toBeNull()
  expect(state.children).toHaveLength(1)
  state.children[0]!.emit("exit", 0)
  await stopped
  await Promise.resolve()
  state.children[1]!.ready()
  await restarted
  expect(state.unexpectedExits).toBe(0)
})
