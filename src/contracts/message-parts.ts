import { z } from "zod"
import type { FunctionCallOutputItem, ResponseInputContent, ResponseOutputItem } from "../domain/chat/types"

export class MessagePartsError extends Error {
  constructor(
    readonly code: "INVALID_JSON" | "INVALID_ENVELOPE" | "UNSUPPORTED_VERSION" | "INVALID_PART",
    message: string,
  ) {
    super(message)
    this.name = "MessagePartsError"
  }
}

const mediaRefSchema = z.object({
  type: z.literal("ccodex_media_ref"),
  kind: z.enum(["image", "file"]),
  mime: z.string().min(1),
  name: z.string().min(1),
  bytes: z.int().nonnegative(),
  sha256: z.string().regex(/^[a-f\d]{64}$/i).optional(),
  path: z.string().regex(/^(?:\/|[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i).optional(),
  turnRead: z.boolean(),
}).refine(ref => ref.sha256 === undefined ? ref.path !== undefined : ref.path === undefined && ref.kind === "image")

export type MediaRefPart = z.infer<typeof mediaRefSchema>
export type StoredContentPart = ResponseInputContent | MediaRefPart | ResponseOutputItem
export type StoredMessagePart = ResponseOutputItem | FunctionCallOutputItem | MediaRefPart

export function isMediaRefPart(value: unknown): value is MediaRefPart {
  return mediaRefSchema.safeParse(value).success
}

const text = z.object({ text: z.string() })
const id = z.string().min(1)
const detail = z.enum(["low", "high", "auto"]).optional()
const knownContent = new Map<string, z.ZodType>([
  ["input_text", text],
  ["output_text", text],
  ["refusal", z.object({ refusal: z.string() })],
  ["input_image", z.object({ image_url: z.string(), detail })],
  ["input_file", z.object({ filename: z.string(), file_data: z.string(), detail })],
  ["ccodex_media_ref", mediaRefSchema],
])

const tagged = z.object({ type: z.string().min(1) })
const content = z.union([z.string(), z.array(z.custom(value => validTagged(value, knownContent)))])
const knownParts = new Map<string, z.ZodType>([
  ["message", z.object({ role: z.enum(["user", "assistant"]), content })],
  ["function_call", z.object({ id, call_id: id, name: z.string().min(1), arguments: z.string() })],
  ["function_call_output", z.object({ call_id: id, output: content })],
  ["reasoning", z.object({
    id,
    summary: z.array(z.object({ type: z.literal("summary_text"), text: z.string() })),
    encrypted_content: z.string().nullish(),
  })],
  ["text", text],
  ["ccodex_media_ref", mediaRefSchema],
])

function validTagged(value: unknown, schemas: ReadonlyMap<string, z.ZodType>): boolean {
  const tag = tagged.safeParse(value)
  if (!tag.success) return false
  return schemas.get(tag.data.type)?.safeParse(value).success ?? true
}

function validateParts(parts: unknown): asserts parts is StoredMessagePart[] {
  if (!Array.isArray(parts)) {
    throw new MessagePartsError("INVALID_ENVELOPE", "parts_json.parts must be an array")
  }
  for (const [index, part] of parts.entries()) {
    if (!validTagged(part, knownParts)) {
      throw new MessagePartsError("INVALID_PART", `Invalid message part at parts[${index}]`)
    }
  }
}

export function encodeParts(parts: readonly StoredMessagePart[]): string {
  validateParts(parts)
  return JSON.stringify({ v: 1, parts })
}

const envelopeSchema = z.object({ v: z.int(), parts: z.unknown() })

export function decodeParts(json: string): StoredMessagePart[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new MessagePartsError("INVALID_JSON", "Malformed parts_json")
  }
  const envelope = envelopeSchema.safeParse(parsed)
  if (!envelope.success) throw new MessagePartsError("INVALID_ENVELOPE", "Invalid parts_json envelope")
  const { v, parts } = envelope.data
  if (v !== 1) throw new MessagePartsError("UNSUPPORTED_VERSION", `Unsupported parts_json version: ${v}`)
  validateParts(parts)
  return parts
}
