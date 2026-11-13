import { Agent, fetch as undiciFetch, Headers as UndiciHeaders } from "undici"
import type { HeadersInit as UndiciHeadersInit, RequestInfo, RequestInit, Response as UndiciResponse } from "undici-types"

export type UndiciFetch = (input: RequestInfo, init?: RequestInit) => Promise<UndiciResponse>

/** HTTP transport for ordinary JSON requests. */
export class HttpClient {
  constructor(private readonly fetchImpl: UndiciFetch = undiciFetch) {}

  async getJson<T>(url: string, headers: UndiciHeadersInit = {}, signal?: AbortSignal): Promise<T> {
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", ...Object.fromEntries(new UndiciHeaders(headers).entries()) },
      signal,
    })
    if (!response.ok) throw new Error(`HTTP request returned ${response.status}: ${await response.text()}`)
    return await response.json() as T
  }

  async postJson<T>(url: string, body: unknown, headers: UndiciHeadersInit = {}, signal?: AbortSignal): Promise<T> {
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...Object.fromEntries(new UndiciHeaders(headers).entries()) },
      body: JSON.stringify(body),
      signal,
    })
    if (!response.ok) throw new Error(`HTTP request returned ${response.status}: ${await response.text()}`)
    return await response.json() as T
  }
}

/** HTTP transport that exposes the response body for incremental streaming. */
export class StreamingHttpClient {
  private readonly dispatcher: Agent

  constructor(
    private readonly fetchImpl: UndiciFetch = undiciFetch,
    options: { responseHeadersTimeoutMs: number; streamIdleTimeoutMs: number },
  ) {
    this.dispatcher = new Agent({
      headersTimeout: options.responseHeadersTimeoutMs,
      bodyTimeout: options.streamIdleTimeoutMs,
    })
  }

  post(url: string, body: unknown, headers: UndiciHeadersInit = {}, signal?: AbortSignal): Promise<UndiciResponse> {
    return this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...Object.fromEntries(new UndiciHeaders(headers).entries()) },
      body: JSON.stringify(body),
      signal,
      dispatcher: this.dispatcher,
    })
  }
}
