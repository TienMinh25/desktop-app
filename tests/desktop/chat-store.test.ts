import { expect, it } from "bun:test"
import type { HarnessCommand } from "../../src/contracts/commands"
import type { HarnessEvent } from "../../src/contracts/events"
import type { SessionRow } from "../../src/contracts/projects"
import type { SessionHistoryTurn } from "../../src/contracts/session-history"
import { QC_MOCK_SESSION_ID, resolveHistoryTurns, useChatStore } from "../../src/desktop/renderer/stores/workspace/chat.store"
import { useProjectStore } from "../../src/desktop/renderer/stores/workspace/project.store"
import { useToastStore } from "../../src/desktop/renderer/stores/app/toast.store"

function makeHistoryTurn(overrides: Partial<SessionHistoryTurn> = {}): SessionHistoryTurn {
  return {
    sessionId: "s1", requestId: "req-1",
    userSeq: 1,
    assistantSeq: 2,
    state: "completed",
    workspacePath: "/repo",
    prompt: "hello",
    assistantText: "world",
    toolCalls: [],
    media: [],
    errorMessage: null,
    updatedAt: 1000,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function withDesktopMock(
  desktop: Record<string, unknown>,
  run: () => void | Promise<void>,
): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window")
  Object.defineProperty(globalThis, "window", { configurable: true, value: { desktop } })
  return Promise.resolve()
    .then(run)
    .finally(() => {
      useChatStore.getState().actions.reset()
      useProjectStore.getState().actions.reset()
      if (original) Object.defineProperty(globalThis, "window", original)
      else Reflect.deleteProperty(globalThis, "window")
    })
}

it("shows failures before start and keeps the active turn when a queued request fails", async () => {
  let emit!: (event: HarnessEvent) => void
  await withDesktopMock(
    {
      subscribeHarnessEvents(listener: typeof emit) { emit = listener; return () => {} },
    },
    () => {
      const store = useChatStore.getState
      store().actions.subscribeHarness()
      const request = { sessionId: "s1", requestId: "a", prompt: "first prompt" }
      emit({ ...request, type: "chat.failed", message: "disk full" })
      expect(store().turns.s1).toMatchObject({ ...request, isStreaming: false, error: "disk full" })

      emit({ ...request, type: "chat.started" })
      const queued = { ...request, requestId: "b", prompt: "second prompt" }
      emit({ ...queued, type: "chat.queued", queuePosition: 1 })
      emit({ ...queued, type: "chat.failed", message: "Session deleted before this prompt started." })
      expect(store().queuedPrompts.s1).toEqual([])
      expect(store().turns.s1).toMatchObject({ ...request, isStreaming: true })
      expect(store().pendingHistoryTurns.s1).toBeUndefined()

      emit({ ...queued, type: "chat.queued", queuePosition: 1 })
      emit({ type: "harness.exited" })
      expect(store().queuedPrompts).toEqual({})
      expect(store().turns.s1).toMatchObject({
        ...request, isStreaming: false, error: "The harness stopped. Prompts that were waiting were lost.",
      })
    },
  )
})

it("loads session history when selecting a session", async () => {
  const historyBySession: Record<string, SessionHistoryTurn[]> = {
    s1: [makeHistoryTurn({ requestId: "r1", prompt: "old prompt" })],
    s2: [],
  }
  await withDesktopMock(
    {
      listSessionHistory: (sessionId: string) => Promise.resolve(historyBySession[sessionId] ?? []),
    },
    async () => {
      useProjectStore.setState({
        assignedProjects: [{ id: "p1", key: "P1", name: "Project 1" }],
        selectedProjectId: "p1",
        sessions: [
          { id: "s1", projectId: "p1", title: "Old chat", hasHistory: false, updatedAt: 2 },
          { id: "s2", projectId: "p1", title: "Empty chat", hasHistory: false, updatedAt: 1 },
        ],
        activeSessionId: "s2",
        isLoaded: true,
      })

      useProjectStore.getState().actions.selectSession("s1")
      await flush()
      expect(useChatStore.getState().history.s1).toEqual(historyBySession.s1)

      useProjectStore.getState().actions.selectSession("s2")
      await flush()
      expect(useChatStore.getState().history.s2).toEqual([])
    },
  )
})

it("drops stale history responses after a session switch or a newer load", async () => {
  const firstS1 = deferred<SessionHistoryTurn[]>()
  const firstS2 = deferred<SessionHistoryTurn[]>()

  await withDesktopMock(
    {
      listSessionHistory: (sessionId: string) => (sessionId === "s1" ? firstS1.promise : firstS2.promise),
    },
    async () => {
      const store = useChatStore.getState
      const p1 = store().actions.loadHistory("s1")
      const p2 = store().actions.loadHistory("s2")

      firstS2.resolve([makeHistoryTurn({ requestId: "r-s2", prompt: "from s2" })])
      await p2
      firstS1.resolve([makeHistoryTurn({ requestId: "r-s1-stale", prompt: "stale s1" })])
      await p1

      expect(store().history.s2?.map((t) => t.requestId)).toEqual(["r-s2"])
      expect(store().history.s1).toBeUndefined()

      // Switch back to s1 and verify a superseded load for the same session is also dropped
      const olderS1 = deferred<SessionHistoryTurn[]>()
      const newerS1 = deferred<SessionHistoryTurn[]>()
      let repeat = 0
      window.desktop.listSessionHistory = () => {
        repeat += 1
        return repeat === 1 ? olderS1.promise : newerS1.promise
      }

      const slowLoad = store().actions.loadHistory("s1")
      const fastLoad = store().actions.loadHistory("s1")
      newerS1.resolve([makeHistoryTurn({ requestId: "r-s1-new" })])
      await fastLoad
      olderS1.resolve([makeHistoryTurn({ requestId: "r-s1-old" })])
      await slowLoad

      expect(store().history.s1?.map((t) => t.requestId)).toEqual(["r-s1-new"])
    },
  )
})

it("keeps the reselected session when a new chat finishes creating in another project", async () => {
  const older = deferred<SessionHistoryTurn[]>()
  const created = deferred<SessionRow>()
  const ready = makeHistoryTurn({ requestId: "reselected" })
  let nextHistory = older.promise

  await withDesktopMock(
    {
      createSession: () => created.promise,
      listSessionHistory: () => nextHistory,
    },
    async () => {
      const store = useProjectStore.getState
      useProjectStore.setState({
        assignedProjects: [
          { id: "p1", key: "P1", name: "Project 1" },
          { id: "p2", key: "P2", name: "Project 2" },
        ],
        sessions: [{ id: "s1", projectId: "p1", title: "Old chat", hasHistory: false, updatedAt: 1 }],
      })
      store().actions.selectSession("s1")
      store().actions.selectProject("p2")
      expect(store().activeSessionId).toBeNull()

      const creating = store().actions.createSessionForPrompt("p2", "New chat")
      older.resolve([makeHistoryTurn({ requestId: "stale" })])
      await flush()
      expect(useChatStore.getState().history.s1).toBeUndefined()

      nextHistory = Promise.resolve([ready])
      store().actions.selectSession("s1")
      created.resolve({ id: "s2", projectId: "p2", title: "New chat", updatedAt: 2, lastPreview: null })
      await creating
      expect(store().activeSessionId).toBe("s1")
      expect(store().sessions.map((session) => session.id)).toEqual(["s2", "s1"])
      expect(useChatStore.getState().history.s1).toEqual([ready])
    },
  )
})

it("rejects a history response from before a reset even when the same session is selected again", async () => {
  const stale = deferred<SessionHistoryTurn[]>()
  const current = deferred<SessionHistoryTurn[]>()
  let next = stale.promise

  await withDesktopMock({ listSessionHistory: () => next }, async () => {
    const store = useChatStore.getState
    const oldLoad = store().actions.loadHistory("s1")
    store().actions.reset()
    next = current.promise
    const newLoad = store().actions.loadHistory("s1")

    stale.resolve([makeHistoryTurn({ requestId: "stale" })])
    expect(await oldLoad).toBeNull()
    expect(store().history.s1).toBeUndefined()

    current.resolve([makeHistoryTurn({ requestId: "current" })])
    await newLoad
    expect(store().history.s1?.map((turn) => turn.requestId)).toEqual(["current"])
  })
})

it("refreshes a completed background turn without replacing the selected session load", async () => {
  let emit!: (event: HarnessEvent) => void
  const selected = deferred<SessionHistoryTurn[]>()
  const staleCompletion = deferred<SessionHistoryTurn[]>()
  const completed = makeHistoryTurn({ requestId: "background" })
  const queuedCompleted = makeHistoryTurn({ requestId: "queued", userSeq: 3, assistantSeq: 4 })
  let background = staleCompletion.promise

  await withDesktopMock(
    {
      subscribeHarnessEvents(listener: typeof emit) { emit = listener; return () => {} },
      listSessionHistory: (sessionId: string) => sessionId === "s1" ? background : selected.promise,
    },
    async () => {
      const store = useChatStore.getState
      store().actions.subscribeHarness()
      useProjectStore.setState({
        sessions: [{ id: "s1", projectId: "p1", title: "Background chat", hasHistory: false, updatedAt: 1 }],
      })
      const first = { sessionId: "s1", requestId: "background", prompt: "background prompt" }
      const queued = { sessionId: "s1", requestId: "queued", prompt: "queued prompt" }
      emit({ ...first, type: "chat.started" })
      emit({ ...queued, type: "chat.queued", queuePosition: 1 })
      emit({ ...first, type: "chat.completed" })

      const selectedLoad = store().actions.loadHistory("s2")
      staleCompletion.resolve([completed])
      await flush()
      expect(store().history.s1).toBeUndefined()
      expect(store().turns.s1?.requestId).toBe("background")

      background = Promise.resolve([completed, queuedCompleted])
      emit({ ...queued, type: "chat.started" })
      emit({ ...queued, type: "chat.completed" })
      await flush()
      expect(store().turns.s1).toBeUndefined()
      expect(store().pendingHistoryTurns.s1).toBeUndefined()
      expect(store().history.s1).toEqual([completed, queuedCompleted])

      selected.resolve([makeHistoryTurn({ requestId: "selected" })])
      await selectedLoad
      expect(store().history.s2?.map((turn) => turn.requestId)).toEqual(["selected"])
    },
  )
})

it("keeps a terminal turn visible until its saved state arrives even after the next prompt starts", async () => {
  let emit!: (event: HarnessEvent) => void
  const first = { sessionId: "s1", requestId: "r1", prompt: "first" }
  const second = { sessionId: "s1", requestId: "r2", prompt: "second" }
  const persisted = makeHistoryTurn({
    requestId: first.requestId,
    state: "failed",
    errorMessage: "Could not finish the turn",
  })
  const initialHistory = deferred<SessionHistoryTurn[]>()
  let nextHistory = initialHistory.promise

  await withDesktopMock(
    {
      subscribeHarnessEvents(listener: typeof emit) { emit = listener; return () => {} },
      listSessionHistory: () => nextHistory,
    },
    async () => {
      const store = useChatStore.getState
      store().actions.subscribeHarness()

      emit({ ...first, type: "chat.started" })
      emit({ ...first, type: "assistant.delta", text: "partial output" })
      emit({ ...second, type: "chat.queued", queuePosition: 1 })
      emit({ ...first, type: "chat.failed", message: "Could not finish the turn" })
      emit({ ...second, type: "chat.started" })
      expect(store().queuedPrompts.s1).toEqual([])
      expect(store().turns.s1).toMatchObject({ requestId: "r2", isStreaming: true })
      expect(store().pendingHistoryTurns.s1).toMatchObject([
        { requestId: "r1", assistantText: "partial output", error: "Could not finish the turn" },
      ])

      initialHistory.resolve([{ ...persisted, state: "running" }])
      await flush()
      expect(store().pendingHistoryTurns.s1).toHaveLength(1)
      expect(resolveHistoryTurns(store().history.s1 ?? [], store().turns.s1, store().pendingHistoryTurns.s1)).toEqual([])

      nextHistory = Promise.resolve([persisted])
      await store().actions.loadHistory("s1")
      expect(store().pendingHistoryTurns.s1).toBeUndefined()
      expect(store().history.s1).toEqual([persisted])
      expect(store().turns.s1).toMatchObject({ requestId: "r2", isStreaming: true })
    },
  )
})

it("removes the live overlay on chat.completed and chat.failed only after history contains the request", async () => {
  let emit!: (event: HarnessEvent) => void
  let nextHistory: SessionHistoryTurn[] = []

  await withDesktopMock(
    {
      subscribeHarnessEvents(listener: typeof emit) { emit = listener; return () => {} },
      listSessionHistory: () => Promise.resolve(nextHistory),
    },
    async () => {
      const store = useChatStore.getState
      store().actions.subscribeHarness()

      emit({ type: "chat.started", sessionId: "s1", requestId: "r1", prompt: "first" })
      emit({ type: "assistant.delta", sessionId: "s1", requestId: "r1", text: "partial" })
      nextHistory = []
      emit({ type: "chat.completed", sessionId: "s1", requestId: "r1" })
      await flush()
      expect(store().turns.s1).toMatchObject({ requestId: "r1", isStreaming: false, assistantText: "partial" })

      const savedR2 = makeHistoryTurn({ requestId: "r2", prompt: "second", assistantText: "done" })
      emit({ type: "chat.started", sessionId: "s1", requestId: "r2", prompt: "second" })
      nextHistory = [savedR2]
      emit({ type: "chat.completed", sessionId: "s1", requestId: "r2" })
      await flush()
      expect(store().turns.s1).toBeUndefined()
      expect(store().history.s1).toEqual([savedR2])

      emit({ type: "chat.started", sessionId: "s1", requestId: "r3", prompt: "third" })
      nextHistory = [savedR2, makeHistoryTurn({ requestId: "r3", state: "running", userSeq: 3, assistantSeq: 4 })]
      emit({ type: "chat.failed", sessionId: "s1", requestId: "r3", prompt: "third", message: "db error" })
      await flush()
      expect(store().turns.s1).toMatchObject({ requestId: "r3", isStreaming: false, error: "db error" })

      const failedR4 = makeHistoryTurn({
        requestId: "r4",
        userSeq: 3,
        assistantSeq: 4,
        state: "failed",
        prompt: "fourth",
        assistantText: "",
        errorMessage: "HTTP 500",
      })
      emit({ type: "chat.started", sessionId: "s1", requestId: "r4", prompt: "fourth" })
      nextHistory = [savedR2, failedR4]
      emit({ type: "chat.failed", sessionId: "s1", requestId: "r4", prompt: "fourth", message: "HTTP 500" })
      await flush()
      expect(store().turns.s1).toBeUndefined()
      expect(store().history.s1).toEqual([savedR2, failedR4])
    },
  )
})

it("maps running history turns without a matching live turn to interrupted", async () => {
  let emit!: (event: HarnessEvent) => void
  const runningOld = makeHistoryTurn({ requestId: "r-old", userSeq: 1, assistantSeq: 2, state: "running" })
  const runningLive = makeHistoryTurn({ requestId: "r-live", userSeq: 3, assistantSeq: 4, state: "running" })

  await withDesktopMock(
    {
      subscribeHarnessEvents(listener: typeof emit) { emit = listener; return () => {} },
      listSessionHistory: () => Promise.resolve([runningOld, runningLive]),
    },
    async () => {
      const store = useChatStore.getState
      store().actions.subscribeHarness()

      await store().actions.loadHistory("s1")
      expect(resolveHistoryTurns(store().history.s1 ?? [], undefined).map(t => [t.requestId, t.state])).toEqual([
        ["r-old", "interrupted"],
        ["r-live", "interrupted"],
      ])

      emit({ type: "chat.started", sessionId: "s1", requestId: "r-live", prompt: "still running" })
      await store().actions.loadHistory("s1")
      const visible = resolveHistoryTurns(store().history.s1 ?? [], store().turns.s1)
      expect(visible.map((t) => [t.requestId, t.state])).toEqual([["r-old", "interrupted"]])
    },
  )
})

it("keeps context.warning entries separate from turn errors", async () => {
  let emit!: (event: HarnessEvent) => void
  await withDesktopMock(
    {
      subscribeHarnessEvents(listener: typeof emit) { emit = listener; return () => {} },
      listSessionHistory: () => Promise.resolve([]),
    },
    async () => {
      const store = useChatStore.getState
      store().actions.subscribeHarness()
      emit({ type: "chat.started", sessionId: "s1", requestId: "r1", prompt: "hi" })
      emit({ type: "context.warning", sessionId: "s1", requestId: "r1", message: "AGENTS.md truncated" })
      emit({ type: "context.warning", sessionId: "s1", requestId: "r1", message: "Rule file unreadable" })

      expect(store().turns.s1?.warnings).toEqual(["AGENTS.md truncated", "Rule file unreadable"])
      expect(store().turns.s1?.error).toBeNull()

      emit({ type: "chat.failed", sessionId: "s1", requestId: "r1", prompt: "hi", message: "HTTP 502" })
      await flush()
      expect(store().turns.s1?.error).toBe("HTTP 502")
      expect(store().turns.s1?.warnings).toEqual(["AGENTS.md truncated", "Rule file unreadable"])
    },
  )
})

it("keeps warnings and todos of a retired turn per session, even when two sessions share a request id", async () => {
  let emit!: (event: HarnessEvent) => void
  const saved = (sessionPrompt: string) => [{
    requestId: "r1", userSeq: 1, assistantSeq: 2, state: "completed" as const, workspacePath: "/repo",
    prompt: sessionPrompt, assistantText: "ok", toolCalls: [], media: [], errorMessage: null, updatedAt: 1,
  }]
  await withDesktopMock(
    {
      subscribeHarnessEvents(listener: typeof emit) { emit = listener; return () => {} },
      sendHarnessCommand() {},
      listSessionHistory: (sessionId: string) => Promise.resolve(saved(sessionId)),
    },
    async () => {
      const store = useChatStore.getState
      store().actions.subscribeHarness()
      emit({ type: "chat.started", sessionId: "s1", requestId: "r1", prompt: "hi" })
      emit({ type: "context.warning", sessionId: "s1", requestId: "r1", message: "AGENTS.md truncated" })
      emit({ type: "todo.updated", sessionId: "s1", requestId: "r1", scopeId: "r1", scopeType: "request", todos: [{ id: "t1", content: "Write test", status: "completed" }] })
      emit({ type: "chat.completed", sessionId: "s1", requestId: "r1" })
      await flush()
      expect(store().turns.s1).toBeUndefined()
      expect(store().retiredTurns.s1?.r1).toEqual({
        warnings: ["AGENTS.md truncated"],
        todos: [{ id: "t1", content: "Write test", status: "completed" }],
      })
      expect(store().retiredTurns.s2?.r1).toBeUndefined()

      store().actions.clearSessionRuntime("s1")
      expect(store().retiredTurns.s1).toBeUndefined()
    },
  )
})

it("marks only a failed first history load, and clears it when a retry succeeds", async () => {
  let fail = true
  await withDesktopMock(
    {
      sendHarnessCommand() {},
      listSessionHistory: () => fail ? Promise.reject(new Error("ipc down")) : Promise.resolve([]),
    },
    async () => {
      const store = useChatStore.getState
      await store().actions.loadHistory("s1")
      expect(store().historyFailed.s1).toBe(true)
      expect(store().history.s1).toBeUndefined()

      fail = false
      await store().actions.loadHistory("s1")
      expect(store().historyFailed.s1).toBeUndefined()
      expect(store().history.s1).toEqual([])

      fail = true
      await store().actions.loadHistory("s1")
      expect(store().historyFailed.s1).toBeUndefined()
      expect(store().history.s1).toEqual([])
    },
  )
})

it("tells the user when a harness exit drops prompts queued behind a finished turn", async () => {
  let emit!: (event: HarnessEvent) => void
  await withDesktopMock(
    { subscribeHarnessEvents(listener: typeof emit) { emit = listener; return () => {} } },
    () => {
      const store = useChatStore.getState
      store().actions.subscribeHarness()
      useToastStore.getState().actions.dismissToast()
      emit({ type: "chat.started", sessionId: "s1", requestId: "a", prompt: "first" })
      emit({ type: "chat.queued", sessionId: "s1", requestId: "b", prompt: "second", queuePosition: 1 })
      emit({ type: "chat.completed", sessionId: "s1", requestId: "a" })
      emit({ type: "harness.exited" })
      expect(store().queuedPrompts).toEqual({})
      expect(useToastStore.getState().activeToast).toMatchObject({ type: "error", message: "The harness stopped. 1 waiting prompt(s) were lost." })
    },
  )
})

it("drains edited renderer prompts after cancellation, completion and failure", async () => {
  let emit!: (event: HarnessEvent) => void
  const commands: HarnessCommand[] = []
  const first = { sessionId: "s1", requestId: "first", prompt: "first" }
  const saved = makeHistoryTurn({ requestId: first.requestId, state: "failed", errorMessage: "Cancelled" })
  await withDesktopMock({
    subscribeHarnessEvents(listener: typeof emit) { emit = listener; return () => {} },
    listSessionHistory: async () => [saved],
    sendHarnessCommand(command: HarnessCommand) { commands.push(command) },
  }, async () => {
    const store = useChatStore.getState
    const actions = store().actions
    actions.subscribeHarness()
    useToastStore.getState().actions.dismissToast()
    emit({ ...first, type: "chat.started" })
    for (const prompt of ["second", "third", "fourth", "discard"]) {
      actions.sendPrompt({ sessionId: "s1", prompt, model: "model", approvalMode: "manual" })
    }
    const [second, third, fourth, discard] = store().queuedPrompts.s1!
    actions.editQueuedPrompt("s1", third!.requestId, "edited")
    actions.deleteQueuedPrompt("s1", discard!.requestId)
    actions.sendQueuedPromptNow("s1", third!.requestId)
    expect(commands).toEqual([{ type: "chat.cancel", sessionId: "s1" }])
    emit({ ...first, type: "chat.failed", message: "Cancelled" })
    expect(commands[1]).toMatchObject({ type: "chat.submit", requestId: third!.requestId, prompt: "edited" })
    await flush()
    expect(store().history.s1).toEqual([saved])
    expect(useToastStore.getState().activeToast).toBeNull()
    emit({ ...third!, sessionId: "s1", type: "chat.started" })
    emit({ requestId: third!.requestId, sessionId: "s1", type: "chat.completed" })
    expect(commands[2]).toMatchObject({ type: "chat.submit", requestId: second!.requestId })
    emit({ ...second!, sessionId: "s1", type: "chat.started" })
    emit({ ...second!, sessionId: "s1", type: "chat.failed", message: "offline" })
    expect(commands[3]).toMatchObject({ type: "chat.submit", requestId: fourth!.requestId })
    expect(commands).toHaveLength(4)
  })
})

it("keeps QC history, queue, answers and session edits in the renderer", async () => {
  const calls: string[] = []
  const desktop = Object.fromEntries(
    ["listSessionHistory", "sendHarnessCommand", "respondToQuestion", "respondToPermission",
      "createSession", "renameSession", "deleteSession"].map((name) => [name, () => { calls.push(name) }]),
  )
  await withDesktopMock(desktop, async () => {
    const id = QC_MOCK_SESSION_ID
    const actions = useChatStore.getState().actions
    const projects = useProjectStore.getState().actions
    useProjectStore.setState({
      assignedProjects: [{ id: "p1", key: "P1", name: "Project 1" }],
      sessions: [{ id, projectId: "p1", title: "QC", hasHistory: true, updatedAt: 0 }],
    })
    actions.initQcMockSession()
    projects.selectSession(id)
    await actions.loadHistory(id)
    const mock = useChatStore.getState().turns[id]!
    actions.respondToQuestion(id, mock.requestId, mock.question!.id, "Skip")
    actions.respondToPermission(id, mock.requestId, "permission", "deny")
    actions.sendPrompt({ sessionId: id, prompt: "qc", model: "model", approvalMode: "manual" })
    const queued = useChatStore.getState().queuedPrompts[id]!.at(-1)!
    actions.sendQueuedPromptNow(id, queued.requestId)
    actions.stopGeneration(id)
    await projects.renameSession(id, "renamed QC")
    expect(useProjectStore.getState().sessions[0]?.title).toBe("renamed QC")
    expect(await projects.deleteSession(id)).toBe(true)
    actions.clearSessionRuntime(id)
    expect(calls).toEqual([])
  })
})

it("shows a harness-queued prompt that fails before starting after the previous turn ends", async () => {
  let emit!: (event: HarnessEvent) => void
  await withDesktopMock({
    subscribeHarnessEvents(listener: typeof emit) { emit = listener; return () => {} },
    listSessionHistory: async () => [],
  }, async () => {
    const store = useChatStore.getState
    store().actions.subscribeHarness()
    const first = { sessionId: "s1", requestId: "first", prompt: "first" }
    const second = { sessionId: "s1", requestId: "second", prompt: "second" }
    emit({ ...first, type: "chat.started" })
    emit({ ...second, type: "chat.queued", queuePosition: 1 })
    emit({ ...first, type: "chat.completed" })
    emit({ ...second, type: "chat.failed", message: "Could not start turn." })
    await flush()

    expect(store().queuedPrompts.s1).toEqual([])
    expect(store().turns.s1).toMatchObject({ ...second, isStreaming: false, error: "Could not start turn." })
    expect(store().pendingHistoryTurns.s1).toMatchObject([{ ...first, isStreaming: false }])
  })
})
