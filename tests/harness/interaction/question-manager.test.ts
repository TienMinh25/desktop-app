import { expect, it } from "bun:test"
import type { HarnessEvent } from "../../../src/contracts/events"
import { QuestionManager } from "../../../src/harness/interaction/question-manager"

it("emits a question and resolves only its matching response", async () => {
  const events: HarnessEvent[] = []
  const questions = new QuestionManager((event) => events.push(event), 1000)
  const answer = questions.ask({ requestId: "request-1", sessionId: "session-1", prompt: "Which approach?", choices: ["A", "B"] })
  const event = events.find((candidate) => candidate.type === "question.required")
  expect(event).toMatchObject({ requestId: "request-1", sessionId: "session-1", prompt: "Which approach?", choices: ["A", "B"] })
  if (event?.type !== "question.required") throw new Error("Expected a question.required event")

  questions.respond("stale-id", "wrong answer")
  questions.respond(event.questionRequestId, "A")

  await expect(answer).resolves.toBe("A")
})

it("expires pending questions and ignores late replies", async () => {
  const events: HarnessEvent[] = []
  const questions = new QuestionManager((event) => events.push(event), 5)
  const answer = questions.ask({ requestId: "request-2", sessionId: "session-2", prompt: "Continue?" })

  await expect(answer).rejects.toThrow("Question request expired")
  const expired = events.find((event) => event.type === "question.expired")
  expect(expired).toBeDefined()
  if (expired?.type === "question.expired") questions.respond(expired.questionRequestId, "too late")
})

it("rejects all pending questions when the manager closes", async () => {
  const questions = new QuestionManager(() => {}, 1000)
  const answer = questions.ask({ requestId: "request-3", sessionId: "session-3", prompt: "Need input" })

  questions.close()

  await expect(answer).rejects.toThrow("Question manager closed")
})
