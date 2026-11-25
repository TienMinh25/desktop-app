import { Fragment, useState } from "react"
import type { SessionHistoryTurn } from "../../../../../../contracts/session-history"
import { INTERRUPTED_TURN_MESSAGE, type TurnState } from "../../../../stores"
import styles from "./ConversationStream.module.scss"

interface ConversationStreamProps {
  historyTurns: SessionHistoryTurn[]
  liveTurn?: TurnState
  onPermissionDecision: (id: string, decision: "allow" | "deny") => void
  onQuestionAnswer: (id: string, answer: string) => void
  pendingPrompts: Array<{ requestId: string; prompt: string }>
}

export function ConversationStream({
  historyTurns,
  liveTurn,
  onPermissionDecision,
  onQuestionAnswer,
  pendingPrompts,
}: ConversationStreamProps) {
  const [answer, setAnswer] = useState("")
  const [missingPaths, setMissingPaths] = useState<Record<string, boolean>>({})

  const submitAnswer = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = answer.trim()
    if (!liveTurn?.question || !trimmed) return
    onQuestionAnswer(liveTurn.question.id, trimmed)
    setAnswer("")
  }

  const openMediaPath = async (filePath: string) => {
    try {
      const result = await window.desktop.openMediaPath(filePath)
      if (!result.ok && result.error === "missing") {
        setMissingPaths((prev) => ({ ...prev, [filePath]: true }))
      } else if (result.ok) {
        setMissingPaths((prev) => (prev[filePath] ? { ...prev, [filePath]: false } : prev))
      }
    } catch {
      // IPC channel errors are already surfaced by the preload listener
    }
  }

  const livePermission = liveTurn?.permission ?? null
  const liveQuestion = liveTurn?.question ?? null

  return (
    <div className={styles.chatScrollArea}>
      {historyTurns.map((turn) => (
        <Fragment key={`${turn.userSeq}-${turn.assistantSeq}`}>
          {turn.prompt && (
            <div className={styles.msgUserRow}>
              <div className={styles.msgUserBubble}>{turn.prompt}</div>
            </div>
          )}
          <div className={styles.msgAiRow}>
            {turn.workspacePath && (
              <div className={styles.turnWorkspacePath} title={turn.workspacePath}>
                {turn.workspacePath}
              </div>
            )}
            {turn.assistantText && (
              <div className={styles.assistantCopyText}>{turn.assistantText}</div>
            )}
            {turn.toolCalls.length > 0 && (
              <section className={styles.todoCard} aria-label="Tool calls">
                <strong>Tools</strong>
                {turn.toolCalls.map((call) => (
                  <div
                    key={call.callId}
                    className={call.status === "pending" ? styles.todoPending : undefined}
                  >
                    {call.status === "done" ? "✓" : call.status === "error" ? "✕" : "○"} {call.name}
                  </div>
                ))}
              </section>
            )}
            {turn.media.length > 0 && (
              <div className={styles.mediaList}>
                {turn.media.map((item, index) =>
                  item.kind === "image" && item.sha256 ? (
                    <img
                      key={`${item.sha256}-${index}`}
                      className={styles.mediaImage}
                      src={`ccodex-media://${item.sha256}`}
                      loading="lazy"
                      alt={item.name}
                    />
                  ) : item.path ? (
                    <div key={`${item.path}-${index}`} className={styles.mediaPathRow}>
                      <button
                        type="button"
                        className={styles.mediaPathButton}
                        onClick={() => {
                          if (item.path) void openMediaPath(item.path)
                        }}
                      >
                        <strong>{item.name}</strong>
                        <span className={styles.mediaPathValue}>{item.path}</span>
                      </button>
                      {missingPaths[item.path] && (
                        <span className={styles.mediaMissingText} role="status">
                          File was moved or deleted.
                        </span>
                      )}
                    </div>
                  ) : null,
                )}
              </div>
            )}
            {turn.state === "interrupted" && (
              <div className={styles.agentStatusLine}>{INTERRUPTED_TURN_MESSAGE}</div>
            )}
            {turn.errorMessage ? (
              <div className={styles.agentStatusLine}>{turn.errorMessage}</div>
            ) : turn.state === "failed" ? (
              <div className={styles.agentStatusLine}>This turn failed.</div>
            ) : null}
          </div>
        </Fragment>
      ))}
      {liveTurn && (
        <>
          <div className={styles.msgUserRow}>
            <div className={styles.msgUserBubble}>{liveTurn.prompt}</div>
          </div>
          <div className={styles.msgAiRow}>
            <div className={styles.assistantCopyText}>
              {liveTurn.assistantText || (liveTurn.isStreaming ? "Thinking…" : "")}
            </div>
            {liveTurn.isStreaming && <div className={styles.agentStatusLine}>Generating response…</div>}
            {liveTurn.toolStatus && <div className={styles.agentStatusLine}>{liveTurn.toolStatus}</div>}
            {liveTurn.warnings.map((warning, index) => (
              <div key={`${index}-${warning}`} className={styles.warningLine} role="status">
                {warning}
              </div>
            ))}
            {livePermission && (
              <section className={styles.permissionCard}>
                <strong>Allow {livePermission.tool} to {livePermission.action}?</strong>
                <span>{livePermission.reason}</span>
                <code>{livePermission.resource}</code>
                <div className={styles.permissionActions}>
                  <button onClick={() => onPermissionDecision(livePermission.id, "deny")}>Deny</button>
                  <button onClick={() => onPermissionDecision(livePermission.id, "allow")}>Allow once</button>
                </div>
              </section>
            )}
            {liveQuestion && (
              <section className={styles.questionCard} aria-live="polite">
                <strong>Question from the agent</strong>
                <span>{liveQuestion.prompt}</span>
                {liveQuestion.choices && (
                  <div className={styles.questionChoices}>
                    {liveQuestion.choices.map((choice) => (
                      <button key={choice} type="button" onClick={() => setAnswer(choice)}>
                        {choice}
                      </button>
                    ))}
                  </div>
                )}
                <form className={styles.questionForm} onSubmit={submitAnswer}>
                  <textarea
                    aria-label="Your answer"
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    maxLength={10_000}
                    autoFocus
                    placeholder="Type your answer…"
                  />
                  <button type="submit" disabled={!answer.trim()}>Send answer</button>
                </form>
              </section>
            )}
            {liveTurn.todos.length > 0 && (
              <section className={styles.todoCard}>
                <strong>Tasks</strong>
                {liveTurn.todos.map((todo) => (
                  <div key={todo.id} className={todo.status === "pending" ? styles.todoPending : undefined}>
                    {todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "◉" : "○"} {todo.content}
                  </div>
                ))}
              </section>
            )}
            {liveTurn.error && <div className={styles.agentStatusLine}>{liveTurn.error}</div>}
          </div>
        </>
      )}
      {pendingPrompts.length > 0 && (
        <section className={styles.todoCard} aria-label="Queued prompts">
          <strong>Queued prompts</strong>
          {pendingPrompts.map((item, index) => (
            <div key={item.requestId} className={styles.todoPending}>
              {index + 1}. {item.prompt}
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
