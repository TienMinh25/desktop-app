import { Fragment, useId, useState } from "react"
import type { SessionHistoryTurn } from "../../../../../../contracts/session-history"
import type { RetiredTurnExtras, TurnState } from "../../../../stores"
import { splitTitleAndBody } from "../../../../utils/text"
import styles from "./ConversationStream.module.scss"

interface ConversationStreamProps {
  historyTurns: SessionHistoryTurn[]
  retiredTurns?: Readonly<Record<string, RetiredTurnExtras>>
  pendingHistoryTurns?: readonly TurnState[]
  liveTurn?: TurnState
  onPermissionDecision: (id: string, decision: "allow" | "deny") => void
  onQuestionAnswer: (id: string, answer: string) => void
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

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
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

function QuestionCard({ question, onQuestionAnswer }: {
  question: NonNullable<TurnState["question"]>
  onQuestionAnswer: ConversationStreamProps["onQuestionAnswer"]
}) {
  const choicesId = useId()
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null)
  const [customAnswer, setCustomAnswer] = useState("")
  const choices = question.choices ?? []
  const { title, body } = splitTitleAndBody(question.prompt)
  const questionTitle = body ? title : "Question from the agent"
  const trimmedAnswer = customAnswer.trim()
  const answer = selectedChoice ?? trimmedAnswer
  const showSelectionAction = choices.length > 0 && (selectedChoice !== null || !trimmedAnswer)

  const submitAnswer = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (answer) onQuestionAnswer(question.id, answer)
  }

  return (
    <section className={styles.questionCard} aria-live="polite">
      <div className={styles.questionHeader}>
        <span className={styles.questionIcon} aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.35" />
            <path d="M8 4.6v3.6l2.2 1.4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <strong className={styles.questionTitle}>{questionTitle}</strong>
      </div>
      <p className={styles.questionDescription}>{body || title}</p>

      <form className={styles.questionForm} onSubmit={submitAnswer}>
        {choices.length > 0 && (
          <fieldset className={styles.questionChoices} aria-label={questionTitle}>
            {choices.map((choice) => {
              const { title, body } = splitTitleAndBody(choice)
              const isSelected = selectedChoice === choice
              return (
                <label key={choice} className={`${styles.questionOptionCard} ${isSelected ? styles.questionOptionSelected : ""}`}>
                  <input
                    className={styles.srOnly}
                    type="radio"
                    name={choicesId}
                    value={choice}
                    checked={isSelected}
                    onChange={() => setSelectedChoice(choice)}
                  />
                  <span className={styles.questionRadio} aria-hidden="true">
                    {isSelected && <span className={styles.questionRadioDot} />}
                  </span>
                  <span className={styles.questionOptionText}>
                    <span className={styles.questionOptionTitle}>{title}</span>
                    {body && <span className={styles.questionOptionBody}>{body}</span>}
                  </span>
                </label>
              )
            })}
          </fieldset>
        )}
        <textarea
          aria-label="Your answer"
          value={customAnswer}
          onChange={(event) => {
            setCustomAnswer(event.target.value)
            setSelectedChoice(null)
          }}
          maxLength={10_000}
          autoFocus={choices.length === 0}
          placeholder={choices.length ? "Type a custom answer…" : "Type your answer…"}
        />
        <div className={styles.questionActions}>
          <button type="button" className={styles.questionSkipBtn} onClick={() => onQuestionAnswer(question.id, "Skipped")}>
            Skip for now
          </button>
          <button type="submit" className={styles.questionContinueBtn} disabled={!answer}>
            {showSelectionAction ? "Continue with selection" : "Send answer"}
          </button>
        </div>
      </form>
    </section>
  )
}

function TurnStatus({ message }: { message: string | null }) {
  if (!message) return null
  return <div className={styles.agentStatusLine} role={message === "Cancelled" ? "status" : undefined}>{message}</div>
}

function RuntimeTurn({ liveTurn, onPermissionDecision, onQuestionAnswer }: {
  liveTurn: TurnState
} & Pick<ConversationStreamProps, "onPermissionDecision" | "onQuestionAnswer">) {
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
          <QuestionCard key={liveQuestion.id} question={liveQuestion} onQuestionAnswer={onQuestionAnswer} />
        )}
        <Todos todos={liveTurn.todos} />
        <TurnStatus message={liveTurn.error} />
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
}: ConversationStreamProps) {
  const [pathProblems, setPathProblems] = useState<Record<string, string | null>>({})

  return (
    <div className={styles.chatScrollArea}>
      {historyTurns.map((turn, index) => (
        <Fragment key={`${turn.userSeq}-${turn.assistantSeq}`}>
          {turn.prompt && (
            <div className={styles.msgUserRow}>
              <div className={styles.msgUserBubble}>{turn.prompt}</div>
            </div>
          )}
          {/* The folder belongs to the prompt, shown only when it changes from the turn before */}
          {turn.workspacePath && turn.workspacePath !== historyTurns[index - 1]?.workspacePath && (
            <div className={styles.turnWorkspacePath} title={turn.workspacePath}>
              Workspace: {folderName(turn.workspacePath)}
            </div>
          )}
          <div className={styles.msgAiRow}>
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
              <div className={styles.agentStatusLine}>This turn was interrupted.</div>
            )}
            <TurnStatus message={turn.errorMessage || (turn.state === "failed" ? "This turn failed." : null)} />
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
    </div>
  )
}
