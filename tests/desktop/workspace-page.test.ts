import { expect, it } from "bun:test"
import { chatPaneView } from "../../src/desktop/renderer/pages/WorkspacePage/WorkspacePage"

it("picks the chat pane from content, first-load failure and load state", () => {
  const base = { hasContent: false, activeSessionId: "s1", historyLoaded: false, historyFailed: false }
  expect(chatPaneView({ ...base, hasContent: true, historyFailed: true })).toBe("stream")
  expect(chatPaneView({ ...base, historyFailed: true })).toBe("failed")
  expect(chatPaneView(base)).toBe("loading")
  expect(chatPaneView({ ...base, historyLoaded: true })).toBe("greeting")
  expect(chatPaneView({ ...base, activeSessionId: null })).toBe("greeting")
})
