import { z } from "zod"

export const API_RESPONSE_CODES = {
  SUCCESS: "0000",
  REQUEST_VALIDATION_FAILED: "1000",
  AUTHENTICATION_REQUIRED: "1001",
  INVALID_REQUEST: "1002",
  INTERNAL_ERROR: "9000",
} as const

export type ApiResponseCode = (typeof API_RESPONSE_CODES)[keyof typeof API_RESPONSE_CODES]

export const ApiPaginationSchema = z.object({
  page: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  total_items: z.number().int().nonnegative(),
  total_pages: z.number().int().nonnegative(),
  has_next: z.boolean(),
  has_previous: z.boolean(),
})

export const ApiMetadataSchema = z.object({
  code: z.string(),
  pagination: ApiPaginationSchema.optional(),
}).loose()

export const ApiFieldErrorSchema = z.object({
  field: z.string(),
  message: z.string(),
})

export const ApiErrorEnvelopeSchema = z.object({
  metadata: z.object({ code: z.string() }).loose(),
  error: z.union([z.string(), z.array(ApiFieldErrorSchema)]),
}).loose()

export function createApiSuccessEnvelopeSchema<T extends z.ZodType>(dataSchema: T) {
  return z.object({
    data: dataSchema,
    metadata: ApiMetadataSchema.extend({
      code: z.literal(API_RESPONSE_CODES.SUCCESS),
    }),
  }).loose()
}

export type ApiPagination = z.infer<typeof ApiPaginationSchema>
export type ApiFieldError = z.infer<typeof ApiFieldErrorSchema>

export interface ParsedApiError {
  code: string | null
  message: string | null
  fieldErrors: ApiFieldError[]
}

/**
 * Parses backend v2 error envelopes:
 * - code "1000": error is [{ field, message }]
 * - code "1001" | "1002" | "9000": error is string
 */
export function parseApiErrorEnvelope(body: unknown): ParsedApiError {
  const parsed = ApiErrorEnvelopeSchema.safeParse(body)
  if (parsed.success) {
    const code = parsed.data.metadata.code
    if (Array.isArray(parsed.data.error)) {
      const fieldErrors = parsed.data.error
      const message = fieldErrors
        .map((item) => (item.field ? `${item.field}: ${item.message}` : item.message))
        .join("; ")
      return { code, message: message || null, fieldErrors }
    }
    return { code, message: parsed.data.error || null, fieldErrors: [] }
  }

  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>
    const code =
      obj.metadata && typeof obj.metadata === "object" && "code" in obj.metadata && typeof obj.metadata.code === "string"
        ? obj.metadata.code
        : null
    if (typeof obj.error === "string") {
      return { code, message: obj.error, fieldErrors: [] }
    }
    if (typeof obj.message === "string") {
      return { code, message: obj.message, fieldErrors: [] }
    }
    return { code, message: null, fieldErrors: [] }
  }

  return { code: null, message: null, fieldErrors: [] }
}
