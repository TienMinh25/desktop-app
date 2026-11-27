import { useState } from "react"
import type { TodoItem } from "../../../../../../contracts/todos"
import { splitTitleAndBody } from "../../../../utils/text"
import styles from "./ConversationStream.module.scss"

interface ConversationStreamProps {
  userPrompt: string
  assistantText: string
  isStreaming: boolean
  error: string | null
  permission: { id: string; tool: string; action: string; resource: string; reason: string } | null
  question: { id: string; prompt: string; choices?: string[] } | null
  onPermissionDecision: (id: string, decision: "allow" | "deny") => void
  onQuestionAnswer: (id: string, answer: string) => void
  todos: TodoItem[]
  toolStatus: string | null
}

export function ConversationStream({
  userPrompt,
  assistantText,
  isStreaming,
  error,
  permission,
  question,
  onPermissionDecision,
  onQuestionAnswer,
  todos,
  toolStatus,
}: ConversationStreamProps) {
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null)
  const [customAnswer, setCustomAnswer] = useState("")
  const [copiedPrompt, setCopiedPrompt] = useState(false)

  const handleCopyPrompt = () => {
    void navigator.clipboard?.writeText(userPrompt).then(() => {
      setCopiedPrompt(true)
      window.setTimeout(() => setCopiedPrompt(false), 1200)
    })
  }

  const hasChoices = Boolean(question?.choices && question.choices.length > 0)
  const questionHeader = question
    ? (() => {
        const parsed = splitTitleAndBody(question.prompt)
        return parsed.body
          ? { title: parsed.title, description: parsed.body }
          : { title: "Question from the agent", description: parsed.title }
      })()
    : null

  const resolvedAnswer = hasChoices ? selectedChoice : customAnswer.trim()

  const handleContinueQuestion = () => {
    if (!question || !resolvedAnswer) return
    onQuestionAnswer(question.id, resolvedAnswer)
    setSelectedChoice(null)
    setCustomAnswer("")
  }

  const handleSkipQuestion = () => {
    if (!question) return
    onQuestionAnswer(question.id, "Skipped")
    setSelectedChoice(null)
    setCustomAnswer("")
  }

  return (
    <div className={styles.chatScrollArea}>
      <div className={styles.msgUserRow}>
        <button
          type="button"
          className={`${styles.copyPromptBtn} ${copiedPrompt ? styles.copied : ""}`}
          title={copiedPrompt ? "Copied" : "Copy prompt"}
          aria-label={copiedPrompt ? "Copied" : "Copy prompt"}
          onClick={handleCopyPrompt}
        >
          {copiedPrompt ? (
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M3.5 8.5l3 3 6-6.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="5.5" y="5.5" width="7.5" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
              <path
                d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5.5A1.5 1.5 0 0 0 4 11h1.5"
                stroke="currentColor"
                strokeWidth="1.3"
              />
            </svg>
          )}
        </button>
        <div className={styles.msgUserBubble}>{userPrompt}</div>
      </div>
      <div className={styles.msgAiRow}>
        <div className={styles.assistantCopyText}>
          {assistantText || (isStreaming ? "Thinking…" : "")}
        </div>
        {isStreaming && <div className={styles.agentStatusLine}>Generating response…</div>}
        {toolStatus && <div className={styles.agentStatusLine}>{toolStatus}</div>}
        {permission && <section className={styles.permissionCard}>
          <strong>Allow {permission.tool} to {permission.action}?</strong>
          <span>{permission.reason}</span>
          <code>{permission.resource}</code>
          <div className={styles.permissionActions}>
            <button onClick={() => onPermissionDecision(permission.id, "deny")}>Deny</button>
            <button onClick={() => onPermissionDecision(permission.id, "allow")}>Allow once</button>
          </div>
        </section>}
        {question && questionHeader && (
          <section className={styles.questionCard} aria-live="polite">
            <div className={styles.questionHeader}>
              <span className={styles.questionIcon} aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.35" />
                  <path
                    d="M8 4.6v3.6l2.2 1.4"
                    stroke="currentColor"
                    strokeWidth="1.35"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <strong className={styles.questionTitle}>{questionHeader.title}</strong>
            </div>

            <p className={styles.questionDescription}>{questionHeader.description}</p>

            {hasChoices ? (
              <div className={styles.questionChoices} role="radiogroup" aria-label={questionHeader.title}>
                {question.choices!.map((choice) => {
                  const { title, body } = splitTitleAndBody(choice)
                  const isSelected = selectedChoice === choice
                  return (
                    <button
                      key={choice}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      className={`${styles.questionOptionCard} ${isSelected ? styles.questionOptionSelected : ""}`}
                      onClick={() => setSelectedChoice(choice)}
                    >
                      <span className={styles.questionRadio} aria-hidden="true">
                        {isSelected && <span className={styles.questionRadioDot} />}
                      </span>
                      <span className={styles.questionOptionText}>
                        <span className={styles.questionOptionTitle}>{title}</span>
                        {body && <span className={styles.questionOptionBody}>{body}</span>}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className={styles.questionForm}>
                <textarea
                  aria-label="Your answer"
                  value={customAnswer}
                  onChange={(event) => setCustomAnswer(event.target.value)}
                  maxLength={10_000}
                  autoFocus
                  placeholder="Type your answer…"
                />
              </div>
            )}

            <div className={styles.questionActions}>
              <button type="button" className={styles.questionSkipBtn} onClick={handleSkipQuestion}>
                Skip for now
              </button>
              <button
                type="button"
                className={styles.questionContinueBtn}
                disabled={!resolvedAnswer}
                onClick={handleContinueQuestion}
              >
                Continue with selection
              </button>
            </div>
          </section>
        )}
        {todos.length > 0 && <section className={styles.todoCard}>
          <strong>Tasks</strong>
          {todos.map((todo) => <div key={todo.id} className={todo.status === "pending" ? styles.todoPending : undefined}>
            {todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "◉" : "○"} {todo.content}
          </div>)}
        </section>}
        {error && <div className={styles.agentStatusLine}>{error}</div>}
      </div>
    </div>
  )
}
