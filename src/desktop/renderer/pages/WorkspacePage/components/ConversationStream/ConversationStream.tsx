import styles from "./ConversationStream.module.scss"
import { useState } from "react"

interface ConversationStreamProps {
  userPrompt: string
  assistantText: string
  isStreaming: boolean
  error: string | null
  permission: { id: string; tool: string; action: string; resource: string; reason: string } | null
  question: { id: string; prompt: string; choices?: string[] } | null
  onPermissionDecision: (id: string, decision: "allow" | "deny") => void
  onQuestionAnswer: (id: string, answer: string) => void
  todos: Array<{ content: string; status: "pending" | "in_progress" | "completed" }>
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
  const [answer, setAnswer] = useState("")
  const submitAnswer = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = answer.trim()
    if (!question || !trimmed) return
    onQuestionAnswer(question.id, trimmed)
    setAnswer("")
  }
  return (
    <div className={styles.chatScrollArea}>
      <div className={styles.msgUserRow}>
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
        {question && <section className={styles.questionCard} aria-live="polite">
          <strong>Question from the agent</strong>
          <span>{question.prompt}</span>
          {question.choices && <div className={styles.questionChoices}>
            {question.choices.map((choice) => <button key={choice} type="button" onClick={() => setAnswer(choice)}>{choice}</button>)}
          </div>}
          <form className={styles.questionForm} onSubmit={submitAnswer}>
            <textarea aria-label="Your answer" value={answer} onChange={(event) => setAnswer(event.target.value)} maxLength={10_000} autoFocus placeholder="Type your answer…" />
            <button type="submit" disabled={!answer.trim()}>Send answer</button>
          </form>
        </section>}
        {todos.length > 0 && <section className={styles.todoCard}>
          <strong>Tasks</strong>
          {todos.map((todo, index) => <div key={`${todo.content}-${index}`} className={todo.status === "pending" ? styles.todoPending : undefined}>
            {todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "◉" : "○"} {todo.content}
          </div>)}
        </section>}
        {error && <div className={styles.agentStatusLine}>{error}</div>}
      </div>
    </div>
  )
}
