import { expect, it } from "bun:test"
import { InMemoryConversationStore } from "../../../src/harness/session/in-memory-conversation-store"

it("keeps conversation histories isolated by session", async () => {
  const store = new InMemoryConversationStore()
  await store.saveMessages("session-a", [{ role: "user", content: "alpha" }])
  await store.saveMessages("session-b", [{ role: "user", content: "beta" }])

  expect(await store.getMessages("session-a")).toEqual([{ role: "user", content: "alpha" }])
  expect(await store.getMessages("session-b")).toEqual([{ role: "user", content: "beta" }])
})

it("clones message arrays at the storage boundary", async () => {
  const store = new InMemoryConversationStore()
  const messages = [{ role: "user" as const, content: "original" }]
  await store.saveMessages("session-a", messages)
  messages[0]!.content = "mutated outside store"
  const loaded = await store.getMessages("session-a")
  loaded[0]!.content = "mutated after load"

  expect(await store.getMessages("session-a")).toEqual([{ role: "user", content: "original" }])
})
