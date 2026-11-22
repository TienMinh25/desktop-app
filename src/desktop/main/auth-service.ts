import { fetch as undiciFetch } from "undici"
import type { Response as UndiciResponse } from "undici-types"
import { API_RESPONSE_CODES, parseApiErrorEnvelope } from "../../contracts/api-response"
import {
  AUTH_INVALID_CREDENTIALS_MESSAGE,
  AUTH_SERVICE_UNAVAILABLE_MESSAGE,
  AuthCredentialsSchema,
  AuthSuccessEnvelopeSchema,
  type AuthState,
  type AuthTokenPair,
} from "../../contracts/auth"
import { getSystemDispatcher } from "../../infrastructure/http/system-ca"
import { logger } from "../../infrastructure/logging/logger"
import { AuthSessionStore } from "./auth-session-store"

const AUTH_REQUEST_TIMEOUT_MS = 15_000

export class AuthServiceError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: "unauthenticated" | "request-failed" = "request-failed",
  ) {
    super(message)
    this.name = "AuthServiceError"
  }
}

export class AuthService {
  private refreshInFlight: Promise<string> | null = null
  private logoutInFlight: Promise<{ remoteLogoutSucceeded: boolean }> | null = null
  private sessionOperationTail: Promise<void> = Promise.resolve()

  constructor(
    private readonly sessionStore: AuthSessionStore,
    private readonly onSessionExpired: () => void,
    private readonly backendHost: string,
    private readonly fetchImpl: typeof undiciFetch = undiciFetch,
  ) {}

  async getAuthState(): Promise<AuthState> {
    const session = await this.sessionStore.load()
    return session
      ? { authenticated: true, username: session.username }
      : { authenticated: false, username: null }
  }

  async login(username: string, password: string): Promise<AuthState> {
    return await this.runSessionOperation(async () => {
      const credentials = AuthCredentialsSchema.parse({ username, password })
      const tokens = await this.requestTokenPair("/auth/login", credentials)
      try {
        await this.sessionStore.save(credentials.username, tokens)
      } catch (error) {
        await this.requestLogout(tokens.access_token)
        throw error
      }
      return { authenticated: true, username: credentials.username }
    })
  }

  async getAccessToken(): Promise<string> {
    const session = await this.sessionStore.load()
    if (!session) throw unauthenticatedError("You are signed out")
    return session.tokens.access_token
  }

  refreshAccessToken(): Promise<string> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.runSessionOperation(() => this.refreshSession()).finally(() => {
        this.refreshInFlight = null
      })
    }
    return this.refreshInFlight
  }

  logout(): Promise<{ remoteLogoutSucceeded: boolean }> {
    if (!this.logoutInFlight) {
      this.logoutInFlight = this.runSessionOperation(() => this.performLogout()).finally(() => {
        this.logoutInFlight = null
      })
    }
    return this.logoutInFlight
  }

  async expireSession(): Promise<void> {
    await this.runSessionOperation(() => this.clearSession())
  }

  private async performLogout(): Promise<{ remoteLogoutSucceeded: boolean }> {
    const session = await this.sessionStore.load().catch(() => null)
    let remoteLogoutSucceeded = false
    try {
      if (session) {
        remoteLogoutSucceeded = await this.requestLogout(session.tokens.access_token)
      }
    } catch {
      // Local logout must succeed even when the backend is unavailable.
    } finally {
      try {
        await this.sessionStore.clear()
      } finally {
        this.onSessionExpired()
      }
    }
    return { remoteLogoutSucceeded }
  }

  private async clearSession(): Promise<void> {
    await this.sessionStore.clear()
    this.onSessionExpired()
  }

  private runSessionOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.sessionOperationTail.then(operation)
    this.sessionOperationTail = result.then(() => undefined, () => undefined)
    return result
  }

  private async refreshSession(): Promise<string> {
    const session = await this.sessionStore.load()
    if (!session) {
      await this.clearSession()
      throw unauthenticatedError("Your session has expired. Please sign in again.")
    }

    try {
      const tokens = await this.requestTokenPair("/auth/refresh", {
        refresh_token: session.tokens.refresh_token,
      })
      await this.sessionStore.save(session.username, tokens)
      return tokens.access_token
    } catch (error) {
      if (error instanceof AuthServiceError && error.status === 401) {
        await this.clearSession()
        throw unauthenticatedError("Your session has expired. Please sign in again.")
      }
      throw error
    }
  }

  private async requestTokenPair(path: string, body: unknown): Promise<AuthTokenPair> {
    const startedAt = Date.now()
    const url = `${this.requireApiBase()}${path}`
    // Authentication payloads contain passwords and refresh tokens; never include them in logs.
    logger.apiRequest("POST", url)

    let response: Awaited<ReturnType<typeof undiciFetch>>
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS),
        dispatcher: getSystemDispatcher(),
      })
    } catch (error) {
      logger.apiError("POST", url, error, Date.now() - startedAt)
      if (error instanceof AuthServiceError) throw error
      throw new AuthServiceError(AUTH_SERVICE_UNAVAILABLE_MESSAGE, null)
    }

    logger.apiResponse("POST", url, response.status, Date.now() - startedAt)

    const responseBody = await readJsonOrNull(response)
    if (!response.ok) {
      const apiError = parseApiErrorEnvelope(responseBody)
      if (response.status >= 500 || apiError.code === API_RESPONSE_CODES.INTERNAL_ERROR) {
        throw new AuthServiceError(AUTH_SERVICE_UNAVAILABLE_MESSAGE, response.status, "request-failed")
      }
      const isAuthError =
        response.status === 401 || apiError.code === API_RESPONSE_CODES.AUTHENTICATION_REQUIRED
      const defaultMessage = isAuthError
        ? AUTH_INVALID_CREDENTIALS_MESSAGE
        : "Sign in failed. Please try again."
      throw new AuthServiceError(
        apiError.message ?? defaultMessage,
        response.status,
        isAuthError ? "unauthenticated" : "request-failed",
      )
    }

    const parsed = AuthSuccessEnvelopeSchema.safeParse(responseBody)
    if (!parsed.success) {
      throw new AuthServiceError(AUTH_SERVICE_UNAVAILABLE_MESSAGE, response.status)
    }
    return parsed.data.data
  }

  private async requestLogout(accessToken: string): Promise<boolean> {
    const startedAt = Date.now()
    const url = `${this.requireApiBase()}/auth/logout`
    logger.apiRequest("POST", url)
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS),
        dispatcher: getSystemDispatcher(),
      })
      logger.apiResponse("POST", url, response.status, Date.now() - startedAt)
      await response.body?.cancel().catch(() => {})
      return response.ok
    } catch (error) {
      logger.apiError("POST", url, error, Date.now() - startedAt)
      throw error
    }
  }

  private requireApiBase(): string {
    if (!this.backendHost) {
      throw new AuthServiceError(AUTH_SERVICE_UNAVAILABLE_MESSAGE, null)
    }
    return `${this.backendHost}/api/v2`
  }
}

async function readJsonOrNull(response: UndiciResponse): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function unauthenticatedError(message: string): AuthServiceError {
  return new AuthServiceError(message, 401, "unauthenticated")
}
