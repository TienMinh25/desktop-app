import { expect, it } from "bun:test"
import { questionTool } from "../../../src/harness/tools/question-tool"
import { createToolTestContext } from "./tool-test-context"

it("waits for a free-form user answer and returns it as the tool result", async () => {
  const fixture = await createToolTestContext()
  try {
    let asked: { prompt: string; choices?: string[] } | undefined
    fixture.context.askUser = async (question) => {
      asked = question
      return "Use the typed event union"
    }

    const preparation = await questionTool.prepare?.({ prompt: "How should I proceed?", choices: ["A", "B"] }, fixture.context)
    expect(preparation?.permissionRequests).toEqual([])
    const result = await questionTool.execute({ prompt: "How should I proceed?", choices: ["A", "B"] }, fixture.context, preparation?.data)

    expect(asked).toEqual({ prompt: "How should I proceed?", choices: ["A", "B"] })
    expect(result).toBe("Use the typed event union")
    expect(fixture.permissionRequirements).toEqual([])
  } finally {
    await fixture.cleanup()
  }
})

it("rejects malformed questions before requesting a user response", async () => {
  const fixture = await createToolTestContext()
  try {
    await expect(questionTool.prepare?.({ prompt: "" }, fixture.context)).rejects.toThrow("prompt")
    await expect(questionTool.prepare?.({ prompt: "Pick", choices: [1] }, fixture.context)).rejects.toThrow("choices")
  } finally {
    await fixture.cleanup()
  }
})
