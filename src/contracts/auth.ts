import { z } from "zod"

export const AuthCredentialsSchema = z.object({
  username: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(10_000),
}).strict()

export const AuthTokenPairSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
}).strict()

export const AuthSuccessEnvelopeSchema = z.object({
  data: AuthTokenPairSchema,
  metadata: z.object({ code: z.literal("0000") }).passthrough(),
}).passthrough()

export const AuthStateSchema = z.object({
  authenticated: z.boolean(),
  username: z.string().nullable(),
}).strict()

export const AuthRpcRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth.rpc.get-access-token"), requestId: z.string().uuid() }).strict(),
  z.object({ type: z.literal("auth.rpc.refresh"), requestId: z.string().uuid() }).strict(),
  z.object({ type: z.literal("auth.rpc.expire-session"), requestId: z.string().uuid() }).strict(),
])

export const AuthRpcResponseSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth.rpc.access-token"), requestId: z.string().uuid(), accessToken: z.string().min(1) }).strict(),
  z.object({ type: z.literal("auth.rpc.result"), requestId: z.string().uuid() }).strict(),
  z.object({ type: z.literal("auth.rpc.error"), requestId: z.string().uuid(), code: z.enum(["unauthenticated", "request-failed"]), message: z.string().max(2_000) }).strict(),
])

export type AuthCredentials = z.infer<typeof AuthCredentialsSchema>
export type AuthTokenPair = z.infer<typeof AuthTokenPairSchema>
export type AuthState = z.infer<typeof AuthStateSchema>
export type AuthRpcRequest = z.infer<typeof AuthRpcRequestSchema>
export type AuthRpcResponse = z.infer<typeof AuthRpcResponseSchema>
