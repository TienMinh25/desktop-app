import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { MessageQueueList } from "../../src/desktop/renderer/pages/WorkspacePage/components/PromptBar/components/MessageQueueList"
import { canManageQueuedPrompt, QC_MOCK_SESSION_ID } from "../../src/desktop/renderer/stores/workspace/chat.store"

test("queued prompts stay visible when their queue controls are unavailable", () => {
  const renderQueue = (sessionId: string) => renderToStaticMarkup(<MessageQueueList
    items={[
      { requestId: "renderer", prompt: "Editable prompt", model: "gpt-5.4", approvalMode: "manual" },
      { requestId: "harness", prompt: "Already sent to the harness" },
    ]}
    canManageItem={(item) => canManageQueuedPrompt(sessionId, item)}
    onSendNow={() => {}}
    onEdit={() => {}}
    onDelete={() => {}}
  />)
  const html = renderQueue("real-session")
  const qcHtml = renderQueue(QC_MOCK_SESSION_ID)
  expect(html).toContain("Editable prompt")
  expect(html).toContain("Already sent to the harness")
  for (const label of ["Send now", "Edit", "Delete"]) {
    expect(html.split(`aria-label="${label}"`)).toHaveLength(2)
    expect(qcHtml.split(`aria-label="${label}"`)).toHaveLength(3)
  }
})
