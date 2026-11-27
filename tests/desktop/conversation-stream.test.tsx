import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { SessionHistoryTurn } from "../../src/contracts/session-history"
import { ConversationStream, MediaPathRow } from "../../src/desktop/renderer/pages/WorkspacePage/components/ConversationStream/ConversationStream"

test("renders stored turns in order, followed by unsettled history and the live turn", () => {
  const hash = "a".repeat(64)
  const first: SessionHistoryTurn = {
    sessionId: "s1", requestId: null, userSeq: 1, assistantSeq: 2, state: "interrupted",
    workspacePath: "/first", prompt: "Older prompt", assistantText: "Partial answer",
    errorMessage: null, updatedAt: 1,
    toolCalls: [
      { callId: "a", name: "read", status: "done" },
      { callId: "b", name: "edit", status: "error" },
      { callId: "c", name: "search", status: "pending" },
    ],
    media: [
      { kind: "image", sha256: hash, name: "screenshot", mime: "image/png", bytes: 12 },
      { kind: "image", path: "/large.png", name: "Large image", mime: "image/png", bytes: 8_000_000 },
      { kind: "file", path: "/notes.pdf", name: "Notes", mime: "application/pdf", bytes: 40 },
    ],
  }
  const live = {
    requestId: "live", sessionId: "s", prompt: "Live prompt", assistantText: "Streaming answer",
    warnings: ["Repository instructions truncated"], error: null, isStreaming: true,
    permission: null, question: null, todos: [], toolStatus: null,
  }
  const html = renderToStaticMarkup(<ConversationStream
    historyTurns={[first, { ...first, userSeq: 3, assistantSeq: 4, prompt: "Later prompt",
      state: "failed", errorMessage: "Provider unavailable", media: [], toolCalls: [] },
    { ...first, userSeq: 5, assistantSeq: 6, prompt: "Stopped prompt",
      state: "failed", errorMessage: "Cancelled", media: [], toolCalls: [] }]}
    pendingHistoryTurns={[{ ...live, requestId: "settled", prompt: "Awaiting history", assistantText: "Settled answer", warnings: [], isStreaming: false }]}
    liveTurn={live}
    onPermissionDecision={() => {}}
    onQuestionAnswer={() => {}}
  />)

  const order = ["Older prompt", "Partial answer", "This turn was interrupted.", "Later prompt",
    "Provider unavailable", "Awaiting history", "Live prompt", "Streaming answer", "Repository instructions truncated"]
  let previous = -1
  for (const label of order) {
    const position = html.indexOf(label)
    expect(position).toBeGreaterThan(previous)
    previous = position
  }
  // Shown under the first prompt only, the second turn uses the same folder
  expect(html).toContain('title="/first">Workspace: first')
  expect(html.split('title="/first"').length - 1).toBe(1)
  for (const [glyph, tool, spoken] of [["✓", "read", "done"], ["✕", "edit", "failed"], ["○", "search", "not finished"]]) {
    expect(html).toContain(`<span aria-hidden="true">${glyph}</span> ${tool}<span>, ${spoken}</span>`)
  }
  const image = html.match(/<img\b[^>]*>/)?.[0]
  expect(image).toContain(`src="ccodex-media://${hash}"`)
  expect(image).toContain('loading="lazy"')
  expect(image).toContain('alt="screenshot"')
  expect(html).toContain('role="status">Cancelled</div>')
  for (const [name, path] of [["Large image", "/large.png"], ["Notes", "/notes.pdf"]]) {
    expect(html).toContain(`<button type="button"><strong>${name}</strong><span>${path}</span></button>`)
  }
})

test("the live question offers keyboard-selectable choices, a custom answer, and Skip", () => {
  const html = renderToStaticMarkup(<ConversationStream
    historyTurns={[]}
    liveTurn={{
      requestId: "live", sessionId: "s1", prompt: "Live prompt", assistantText: "",
      warnings: [], error: null, isStreaming: true, permission: null, todos: [], toolStatus: null,
      question: { id: "q1", prompt: "Choose a strategy\nWhere should the session live?", choices: ["Cookies\nKeep it on the server."] },
    }}
    onPermissionDecision={() => {}}
    onQuestionAnswer={() => {}}
  />)
  expect(html).toContain('<fieldset aria-label="Choose a strategy">')
  expect(html).toContain('type="radio"')
  expect(html).toContain("Keep it on the server.")
  expect(html).toContain('aria-label="Your answer"')
  expect(html).toContain("Skip for now")
  expect(html).toContain('disabled="">Continue with selection')
})

test("the path button opens its exact path and shows why it could not, until a successful retry", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window")
  const opened: string[] = []
  const results = [{ ok: false, error: "missing" }, { ok: false, error: "not-allowed" }, { ok: true }]
  Object.defineProperty(globalThis, "window", { configurable: true, value: { desktop: {
    async openMediaPath(path: string) {
      opened.push(path)
      return results[opened.length - 1]
    },
  } } })
  try {
    let problem: string | null = null
    const row = () => MediaPathRow({ path: "/some file.pdf", name: "Document", problem, setProblem(value) { problem = value } })
    const button = () => row().props.children[0]
    expect(button().type).toBe("button")
    await button().props.onClick()
    expect(renderToStaticMarkup(row())).toContain('role="status">File was moved or deleted.')
    await button().props.onClick()
    expect(renderToStaticMarkup(row())).toContain('role="status">This file cannot be opened.')
    await button().props.onClick()
    expect(renderToStaticMarkup(row())).not.toContain('role="status"')
    expect(opened).toEqual(["/some file.pdf", "/some file.pdf", "/some file.pdf"])
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original)
    else Reflect.deleteProperty(globalThis, "window")
  }
})

test("a history turn shows its kept warnings, todos and spoken tool status", () => {
  const turn: SessionHistoryTurn = {
    sessionId: "s1", requestId: "w1", userSeq: 1, assistantSeq: 2, state: "completed", workspacePath: null,
    prompt: "Prompt", assistantText: "Answer", errorMessage: null, updatedAt: 1,
    toolCalls: [{ callId: "a", name: "read", status: "error" }], media: [],
  }
  const html = renderToStaticMarkup(<ConversationStream
    historyTurns={[turn]}
    retiredTurns={{ w1: { warnings: ["AGENTS.md truncated"], todos: [{ id: "t1", content: "Write test", status: "completed" }] } }}
    onPermissionDecision={() => {}}
    onQuestionAnswer={() => {}}
  />)
  expect(html).toContain('role="status">AGENTS.md truncated')
  expect(html).toContain("✓ Write test")
  expect(html).toContain('<span aria-hidden="true">✕</span>')
  expect(html).toContain(", failed")
})
