import { HARNESS_EVENT_TYPES, type HarnessEvent } from "../../contracts/events"

export interface UserQuestion {
  requestId: string
  sessionId: string
  prompt: string
  choices?: string[]
}

interface PendingQuestion {
  resolve(answer: string): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

/** Pauses a tool call until the renderer replies to its matching question. */
export class QuestionManager {
  private readonly pending = new Map<string, PendingQuestion>()
  private closed = false

  constructor(
    private readonly emit: (event: HarnessEvent) => void,
    private readonly timeoutMs = 5 * 60_000,
  ) {}

  ask(question: UserQuestion): Promise<string> {
    if (this.closed) return Promise.reject(new Error("Question manager closed"))
    const questionRequestId = crypto.randomUUID()
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(questionRequestId)
        this.emit({ type: HARNESS_EVENT_TYPES.QUESTION_EXPIRED, requestId: question.requestId, sessionId: question.sessionId, questionRequestId })
        reject(new Error("Question request expired"))
      }, this.timeoutMs)
      this.pending.set(questionRequestId, { resolve, reject, timer })
      this.emit({ type: HARNESS_EVENT_TYPES.QUESTION_REQUIRED, ...question, questionRequestId })
    })
  }

  respond(questionRequestId: string, answer: string): void {
    const pending = this.pending.get(questionRequestId)
    if (!pending) return
    this.pending.delete(questionRequestId)
    clearTimeout(pending.timer)
    pending.resolve(answer)
  }

  close(): void {
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error("Question manager closed"))
    }
    this.pending.clear()
  }
}
