import {
  AuthRpcResponseSchema,
  type AuthRpcRequest,
  type AuthRpcResponse,
} from "../contracts/auth"
import { AuthenticationExpiredError } from "../infrastructure/http/backend-http-client"

interface ParentPortLike {
  postMessage(message: AuthRpcRequest): void
  on(event: "message", listener: (event: { data: unknown }) => void): void
  removeListener(event: "message", listener: (event: { data: unknown }) => void): void
}

type PendingRequest = {
  resolve: (response: AuthRpcResponse) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export class AuthTokenProvider {
  private readonly pending = new Map<string, PendingRequest>()
  private readonly onMessage = (event: { data: unknown }) => this.handleMessage(event.data)

  constructor(private readonly parentPort: ParentPortLike) {
    parentPort.on("message", this.onMessage)
  }

  async getAccessToken(): Promise<string> {
    const response = await this.request("auth.rpc.get-access-token")
    if (response.type === "auth.rpc.error") throw this.asError(response)
    if (response.type !== "auth.rpc.access-token") throw new Error("Unexpected auth RPC response")
    return response.accessToken
  }

  async refreshAccessToken(): Promise<string> {
    const response = await this.request("auth.rpc.refresh")
    if (response.type === "auth.rpc.error") throw this.asError(response)
    if (response.type !== "auth.rpc.access-token") throw new Error("Unexpected auth RPC response")
    return response.accessToken
  }

  async expireSession(): Promise<void> {
    const response = await this.request("auth.rpc.expire-session")
    if (response.type === "auth.rpc.error") throw this.asError(response)
  }

  close(): void {
    this.parentPort.removeListener("message", this.onMessage)
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(new Error("Auth RPC closed"))
      this.pending.delete(requestId)
    }
  }

  private request(type: AuthRpcRequest["type"]): Promise<AuthRpcResponse> {
    const requestId = crypto.randomUUID()
    const request = { type, requestId } as AuthRpcRequest
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error("Auth request to Electron main timed out"))
      }, 30_000)
      this.pending.set(requestId, { resolve, reject, timeout })
      this.parentPort.postMessage(request)
    })
  }

  private handleMessage(value: unknown): void {
    const parsed = AuthRpcResponseSchema.safeParse(value)
    if (!parsed.success) return
    const pending = this.pending.get(parsed.data.requestId)
    if (!pending) return
    clearTimeout(pending.timeout)
    this.pending.delete(parsed.data.requestId)
    pending.resolve(parsed.data)
  }

  private asError(response: Extract<AuthRpcResponse, { type: "auth.rpc.error" }>): Error {
    return response.code === "unauthenticated"
      ? new AuthenticationExpiredError(response.message)
      : new Error(response.message)
  }
}
