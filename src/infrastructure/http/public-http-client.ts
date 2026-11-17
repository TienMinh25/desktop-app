import { fetch as undiciFetch, Headers as UndiciHeaders } from "undici"
import type { HeadersInit } from "undici-types"

export type PublicHttpFetch = typeof undiciFetch

/** Unauthenticated HTTP client for public APIs such as the MCP Registry. */
export class PublicHttpClient {
  constructor(private readonly fetchImpl: PublicHttpFetch = undiciFetch) {}

  async getJson<T>(url: string, headers: HeadersInit = {}, signal?: AbortSignal): Promise<T> {
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", ...Object.fromEntries(new UndiciHeaders(headers).entries()) },
      signal,
    })
    if (!response.ok) throw new Error(`HTTP request returned ${response.status}: ${await response.text()}`)
    return await response.json() as T
  }

  async postJson<T>(url: string, body: unknown, headers: HeadersInit = {}, signal?: AbortSignal): Promise<T> {
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
