import { Agent, fetch as undiciFetch, Headers as UndiciHeaders } from "undici"
import type { HeadersInit, RequestInfo, RequestInit, Response } from "undici-types"

export interface AuthTokenProvider {
  getAccessToken(): Promise<string>
  refreshAccessToken(): Promise<string>
  expireSession(): Promise<void>
}

export type BackendFetch = (input: RequestInfo, init?: RequestInit) => Promise<Response>

const DEFAULT_RESPONSE_HEADERS_TIMEOUT_MS = 300_000
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 900_000

export class AuthenticationExpiredError extends Error {
  constructor(message = "Your session has expired. Please sign in again.") {
    super(message)
    this.name = "AuthenticationExpiredError"
  }
}

/** Authenticated client for backend JSON and streaming APIs. */
export class BackendHttpClient {
  private readonly backendOrigin: string
  private readonly dispatcher: Agent
  private readonly fetchImpl: BackendFetch

  constructor(
    backendHost: string,
    private readonly tokenProvider: AuthTokenProvider,
    options: { responseHeadersTimeoutMs: number; streamIdleTimeoutMs: number } = {
      responseHeadersTimeoutMs: DEFAULT_RESPONSE_HEADERS_TIMEOUT_MS,
      streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    },
    fetchImpl: BackendFetch = undiciFetch,
  ) {
    this.backendOrigin = normalizeBackendHost(backendHost)
    this.dispatcher = new Agent({
      headersTimeout: options.responseHeadersTimeoutMs,
      bodyTimeout: options.streamIdleTimeoutMs,
    })
    this.fetchImpl = this.createAuthenticatedFetch(fetchImpl)
  }

  async getJson<T>(path: string, headers: HeadersInit = {}, signal?: AbortSignal): Promise<T> {
    return await this.requestJson<T>(path, { method: "GET", headers, signal })
  }

  async postJson<T>(path: string, body: unknown, headers: HeadersInit = {}, signal?: AbortSignal): Promise<T> {
    const requestHeaders = new UndiciHeaders(headers)
    requestHeaders.set("Content-Type", "application/json")
    return await this.requestJson<T>(path, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body),
      signal,
    })
  }

  postSerialized(path: string, body: string, headers: HeadersInit = {}, signal?: AbortSignal): Promise<Response> {
    const requestHeaders = new UndiciHeaders(headers)
    requestHeaders.set("Content-Type", "application/json")
    return this.fetchImpl(resolveBackendUrl(this.backendOrigin, path), {
      method: "POST",
      headers: requestHeaders,
      body,
      signal,
      dispatcher: this.dispatcher,
    })
  }

  close(): Promise<void> {
    return this.dispatcher.close()
  }

  private async requestJson<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.fetchImpl(resolveBackendUrl(this.backendOrigin, path), init)
    if (!response.ok) throw new Error(`Backend API returned ${response.status}: ${await response.text()}`)
    return await response.json() as T
  }

  private createAuthenticatedFetch(fetchImpl: BackendFetch): BackendFetch {
    let refreshInFlight: Promise<string> | null = null
    const refreshAccessToken = () => {
      if (!refreshInFlight) {
        refreshInFlight = this.tokenProvider.refreshAccessToken().finally(() => {
          refreshInFlight = null
        })
      }
      return refreshInFlight
    }

    return async (input, init) => {
      const url = resolveRequestUrl(input, new URL(`${this.backendOrigin}/`))
      if (url.origin !== this.backendOrigin || !/^\/api\/v[12]\//.test(url.pathname)) {
        throw new Error("Backend clients can only request versioned routes on the configured backend origin")
      }
      if (isPublicAuthPath(url.pathname)) return fetchImpl(input, init)

      const attempts = createRequestAttempts(input, init)
      const accessToken = await this.tokenProvider.getAccessToken()
      const response = await dispatchWithToken(fetchImpl, attempts.first, init, accessToken)
      if (response.status !== 401) return response
      if (isAborted(input, init)) return response
      if (!attempts.retry) {
        await response.body?.cancel().catch(() => {})
        throw new Error("The request body cannot be replayed after access-token refresh")
      }

      await response.body?.cancel().catch(() => {})
      const refreshedToken = await refreshAccessToken()
      if (isAborted(input, init)) throw getAbortError(input, init)

      const retryResponse = await dispatchWithToken(fetchImpl, attempts.retry, init, refreshedToken)
      if (retryResponse.status === 401) {
        await retryResponse.body?.cancel().catch(() => {})
        await this.tokenProvider.expireSession()
        throw new AuthenticationExpiredError()
      }
      return retryResponse
    }
  }
}

function normalizeBackendHost(value: string): string {
  if (!value.trim()) throw new Error("BACKEND_HOST is not configured")
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("BACKEND_HOST must be a valid URL")
  }

  const isLocalHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]"
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalHost)) {
    throw new Error("BACKEND_HOST must use HTTPS")
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("BACKEND_HOST must contain only the backend origin")
  }
  return url.origin
}

function resolveBackendUrl(backendOrigin: string, path: string): string {
  const relativePath = path.replace(/^\/+/, "")
  if (!relativePath || relativePath.includes("\\") || relativePath.startsWith("..")) {
    throw new Error("Backend API path is invalid")
  }
  const url = new URL(relativePath, `${backendOrigin}/`)
  if (url.origin !== backendOrigin || !/^\/api\/v[12]\//.test(url.pathname)) {
    throw new Error("Backend API path must use a supported versioned API route")
  }
  return url.toString()
}

function resolveRequestUrl(input: RequestInfo, baseUrl: URL): URL {
  const value = input instanceof Request ? input.url : String(input)
  try {
    return new URL(value, baseUrl)
  } catch {
    throw new Error("Backend API request URL is invalid")
  }
}

function isPublicAuthPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "")
  return path === "/api/v2/auth/login" || path === "/api/v2/auth/refresh"
}

function isAborted(input: RequestInfo, init?: RequestInit): boolean {
  return Boolean(init?.signal?.aborted || (input instanceof Request && input.signal.aborted))
}

function getAbortError(input: RequestInfo, init?: RequestInit): unknown {
  if (init?.signal?.aborted) return init.signal.reason ?? new DOMException("The operation was aborted", "AbortError")
  if (input instanceof Request && input.signal.aborted) {
    return input.signal.reason ?? new DOMException("The operation was aborted", "AbortError")
  }
  return new DOMException("The operation was aborted", "AbortError")
}

function createRequestAttempts(
  input: RequestInfo,
  init?: RequestInit,
): { first: RequestInfo; retry: RequestInfo | null } {
  if (input instanceof Request && init?.body === undefined) {
    try {
      return { first: input.clone() as unknown as RequestInfo, retry: input.clone() as unknown as RequestInfo }
    } catch {
      return { first: input, retry: null }
    }
  }
  return {
    first: input,
    retry: isReplayableBody(init?.body) ? input : null,
  }
}

function isReplayableBody(body: RequestInit["body"]): boolean {
  if (body === undefined || body === null) return true
  if (typeof body === "string" || body instanceof URLSearchParams || body instanceof Blob || body instanceof FormData) return true
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return true
  return false
}

function dispatchWithToken(
  fetchImpl: BackendFetch,
  input: RequestInfo,
  init: RequestInit | undefined,
  accessToken: string,
): Promise<Response> {
  const headers = new UndiciHeaders(init?.headers)
  if (input instanceof Request && init?.headers === undefined) {
    new UndiciHeaders(input.headers).forEach((value, key) => headers.set(key, value))
  }
  headers.set("Authorization", `Bearer ${accessToken}`)
  return fetchImpl(input, { ...init, headers })
}
