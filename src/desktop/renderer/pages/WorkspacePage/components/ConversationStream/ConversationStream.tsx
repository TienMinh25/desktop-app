import { Fragment, useState } from "react"
import type { SessionHistoryTurn } from "../../../../../../contracts/session-history"
import { INTERRUPTED_TURN_MESSAGE, type RetiredTurnExtras, type TurnState } from "../../../../stores"
import styles from "./ConversationStream.module.scss"

interface ConversationStreamProps {
  historyTurns: SessionHistoryTurn[]
  retiredTurns?: Readonly<Record<string, RetiredTurnExtras>>
  pendingHistoryTurns?: readonly TurnState[]
  liveTurn?: TurnState
  onPermissionDecision: (id: string, decision: "allow" | "deny") => void
  onQuestionAnswer: (id: string, answer: string) => void
  pendingPrompts: Array<{ requestId: string; prompt: string }>
}

interface MediaPathRowProps {
  path: string
  name: string
  problem: string | null
  setProblem: (problem: string | null) => void
}

export function MediaPathRow({ path, name, problem, setProblem }: MediaPathRowProps) {
  async function open() {
    try {
      const result = await window.desktop.openMediaPath(path)
      setProblem(result.ok ? null : result.error === "missing" ? "File was moved or deleted." : "This file cannot be opened.")
    } catch {
      // The preload reports IPC failures to the global error toast.
    }
  }

  return (
    <div className={styles.mediaPathRow}>
      <button type="button" className={styles.mediaPathButton} onClick={open}>
        <strong>{name}</strong>
        <span className={styles.mediaPathValue}>{path}</span>
      </button>
      {problem && <span className={styles.mediaMissingText} role="status">{problem}</span>}
    </div>
  )
}

function Warnings({ warnings }: { warnings: readonly string[] }) {
  return warnings.map((warning, index) => (
    <div key={`${index}-${warning}`} className={styles.warningLine} role="status">
      {warning}
    </div>
  ))
}

function Todos({ todos }: { todos: TurnState["todos"] }) {
  if (todos.length === 0) return null
  return (
    <section className={styles.todoCard}>
      <strong>Tasks</strong>
      {todos.map((todo) => (
        <div key={todo.id} className={todo.status === "pending" ? styles.todoPending : undefined}>
          {todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "◉" : "○"} {todo.content}
        </div>
      ))}
    </section>
  )
}

function RuntimeTurn({ liveTurn, onPermissionDecision, onQuestionAnswer }: {
  liveTurn: TurnState
} & Pick<ConversationStreamProps, "onPermissionDecision" | "onQuestionAnswer">) {
  const [answer, setAnswer] = useState("")

  const submitAnswer = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = answer.trim()
    if (!liveTurn.question || !trimmed) return
    onQuestionAnswer(liveTurn.question.id, trimmed)
    setAnswer("")
  }

  const livePermission = liveTurn.permission
  const liveQuestion = liveTurn.question

  return (
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
        <Warnings warnings={liveTurn.warnings} />
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
        <Todos todos={liveTurn.todos} />
        {liveTurn.error && <div className={styles.agentStatusLine}>{liveTurn.error}</div>}
      </div>
    </>
  )
}

export function ConversationStream({
  historyTurns,
  retiredTurns = {},
  pendingHistoryTurns = [],
  liveTurn,
  onPermissionDecision,
  onQuestionAnswer,
  pendingPrompts,
}: ConversationStreamProps) {
  const [pathProblems, setPathProblems] = useState<Record<string, string | null>>({})

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
                    <span aria-hidden="true">{call.status === "done" ? "✓" : call.status === "error" ? "✕" : "○"}</span>{" "}
                    {call.name}
                    <span className={styles.srOnly}>{call.status === "done" ? ", done" : call.status === "error" ? ", failed" : ", not finished"}</span>
                  </div>
                ))}
              </section>
            )}
            {turn.media.length > 0 && (
              <div className={styles.mediaList}>
                {turn.media.map(({ kind, sha256, name, path }, index) =>
                  kind === "image" && sha256 ? (
                    <img
                      key={`${sha256}-${index}`}
                      className={styles.mediaImage}
                      src={`ccodex-media://${sha256}`}
                      loading="lazy"
                      alt={name}
                    />
                  ) : path ? (
                    <MediaPathRow
                      key={`${path}-${index}`}
                      path={path}
                      name={name}
                      problem={pathProblems[path] ?? null}
                      setProblem={(problem) => setPathProblems(prev => ({ ...prev, [path]: problem }))}
                    />
                  ) : null,
                )}
              </div>
            )}
            {turn.requestId && retiredTurns[turn.requestId] && (
              <>
                <Warnings warnings={retiredTurns[turn.requestId]!.warnings} />
                <Todos todos={retiredTurns[turn.requestId]!.todos} />
              </>
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
      {(liveTurn ? [...pendingHistoryTurns, liveTurn] : pendingHistoryTurns).map(turn => (
        <RuntimeTurn
          key={turn.requestId}
          liveTurn={turn}
          onPermissionDecision={onPermissionDecision}
          onQuestionAnswer={onQuestionAnswer}
        />
      ))}
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
