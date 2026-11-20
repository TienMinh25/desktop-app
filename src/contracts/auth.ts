import { z } from "zod"
import { createApiSuccessEnvelopeSchema } from "./api-response"

export const AuthCredentialsSchema = z.object({
  username: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(10_000),
}).strict()

export const AuthTokenPairSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
}).strict()

export const AuthSuccessEnvelopeSchema = createApiSuccessEnvelopeSchema(AuthTokenPairSchema)

export const AuthStateSchema = z.object({
  authenticated: z.boolean(),
  username: z.string().nullable(),
}).strict()

export const AuthRpcRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth.rpc.get-access-token"), requestId: z.uuid() }).strict(),
  z.object({ type: z.literal("auth.rpc.refresh"), requestId: z.uuid() }).strict(),
  z.object({ type: z.literal("auth.rpc.expire-session"), requestId: z.uuid() }).strict(),
])

export const AuthRpcResponseSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth.rpc.access-token"), requestId: z.uuid(), accessToken: z.string().min(1) }).strict(),
  z.object({ type: z.literal("auth.rpc.result"), requestId: z.uuid() }).strict(),
  z.object({ type: z.literal("auth.rpc.error"), requestId: z.uuid(), code: z.enum(["unauthenticated", "request-failed"]), message: z.string().max(2_000) }).strict(),
])

export type AuthCredentials = z.infer<typeof AuthCredentialsSchema>
export type AuthTokenPair = z.infer<typeof AuthTokenPairSchema>
export type AuthState = z.infer<typeof AuthStateSchema>
export type AuthRpcRequest = z.infer<typeof AuthRpcRequestSchema>
export type AuthRpcResponse = z.infer<typeof AuthRpcResponseSchema>

export const AUTH_SERVICE_UNAVAILABLE_MESSAGE =
  "Authentication service temporarily unavailable. Please check your network connection and try again."
export const AUTH_INVALID_CREDENTIALS_MESSAGE =
  "Invalid username or password. Please try again."
