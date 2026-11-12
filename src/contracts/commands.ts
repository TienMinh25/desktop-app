import type { ApprovalMode } from "./permissions"
import { z } from "zod"
import { HARNESS_COMMAND_TYPES } from "./message-types"

const shortId = z.string().max(199)

export const PingCommandSchema = z.object({ type: z.literal(HARNESS_COMMAND_TYPES.PING), requestId: shortId }).strict()

export const SubmitPromptCommandSchema = z.object({
  type: z.literal(HARNESS_COMMAND_TYPES.CHAT_SUBMIT), 
  requestId: shortId, 
  sessionId: shortId,
  prompt: z.string().min(1).max(100_000), 
  model: z.string().min(1).max(199),
  workspacePath: z.string().max(3999).optional(),
  approvalMode: z.enum(["manual", "auto-safe", "full-access"] satisfies readonly ApprovalMode[]),
}).strict()

export const PermissionResponseCommandSchema = z.object({
  type: z.literal(HARNESS_COMMAND_TYPES.PERMISSION_RESPOND), 
  permissionRequestId: shortId, 
  decision: z.enum(["allow", "deny"]),
}).strict()

export const QuestionResponseCommandSchema = z.object({
  type: z.literal(HARNESS_COMMAND_TYPES.QUESTION_RESPOND), 
  questionRequestId: z.string().min(1).max(199),
  answer: z.string().trim().min(1).max(10_000),
}).strict()

export const HarnessCommandSchema = z.discriminatedUnion("type", [
  PingCommandSchema, SubmitPromptCommandSchema, PermissionResponseCommandSchema, QuestionResponseCommandSchema,
])

export type PingCommand = z.infer<typeof PingCommandSchema>
export type SubmitPromptCommand = z.infer<typeof SubmitPromptCommandSchema>
export type PermissionResponseCommand = z.infer<typeof PermissionResponseCommandSchema>
export type QuestionResponseCommand = z.infer<typeof QuestionResponseCommandSchema>
export type HarnessCommand = z.infer<typeof HarnessCommandSchema>

