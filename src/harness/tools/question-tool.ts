import type { HarnessTool } from "../agent/tool-registry"
import type { UserQuestion } from "../interaction/question-manager"
import { definition, objectArgs, stringArg } from "./tool-utils"

export const questionTool: HarnessTool = {
  definition: definition("question", "Ask the user a question and wait for a free-form reply before continuing.", {
    prompt: { type: "string", description: "The question to show the user" },
    choices: { type: "array", items: { type: "string" }, description: "Optional suggestions; the user can still enter a different answer" },
  }, ["prompt"]),
  async prepare(value) {
    const args = objectArgs(value)
    const prompt = stringArg(args, "prompt")
    if (prompt.length > 2000) throw new Error("prompt must be at most 2,000 characters")
    let choices: string[] | undefined
    if (args.choices !== undefined) {
      if (!Array.isArray(args.choices) || args.choices.length > 8 || args.choices.some((choice) => typeof choice !== "string" || !choice.trim() || choice.length > 200)) {
        throw new Error("choices must contain up to 8 non-empty strings of at most 200 characters")
      }
      choices = args.choices
    }
    const question: Omit<UserQuestion, "requestId" | "sessionId"> = { prompt, ...(choices ? { choices } : {}) }
    return { permissionRequests: [], data: question }
  },
  execute(_value, context, prepared) {
    const question = prepared as Omit<UserQuestion, "requestId" | "sessionId">
    return context.askUser(question)
  },
}
