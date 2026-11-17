import type { HarnessTool } from "../agent/tool-registry"
import { definition, objectArgs, permissionRequest, stringArg } from "./tool-utils"

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const MAX_OUTPUT_BYTES = 50 * 1024
const MAX_REDIRECTS = 10
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export const webfetchTool: HarnessTool = {
  definition: definition("webfetch", "Fetch text-like content from an HTTP or HTTPS URL. Follows up to 10 redirects, downloads at most 5 MiB, and returns at most 50 KiB to the model. Requires approval for the URL and each redirect destination.", { url: { type: "string" } }, ["url"]),
  async prepare(value) {
    const url = validateHttpUrl(stringArg(objectArgs(value), "url"))
    url.hash = ""
    return { permissionRequests: [permissionRequest("webfetch", "fetch a URL", url.href, true)], data: url.href }
  },
  async execute(_value, context, prepared) {
    let url = validateHttpUrl(prepared as string)
    const signal = AbortSignal.timeout(30_000)
    let response: Response
    for (let redirects = 0; ; redirects += 1) {
      response = await fetch(url, { redirect: "manual", signal, headers: { "user-agent": "DesktopHarness/0.1" } })
      const location = response.headers.get("location")
      if (!REDIRECT_STATUSES.has(response.status) || !location) break
      if (redirects >= MAX_REDIRECTS) {
        await response.body?.cancel()
        throw new Error(`Too many redirects (maximum ${MAX_REDIRECTS})`)
      }

      await response.body?.cancel()
      const nextUrl = validateHttpUrl(new URL(location, url))
      nextUrl.hash = ""
      await context.requirePermission(permissionRequest("webfetch", "follow a redirect to", nextUrl.href, true))
      url = nextUrl
    }

    const contentType = response.headers.get("content-type") ?? ""
    if (!contentType.includes("text") && !contentType.includes("json") && !contentType.includes("xml")) {
      await response.body?.cancel()
      throw new Error(`Unsupported content type: ${contentType}`)
    }
    if (!response.body) return `HTTP ${response.status}\n(no response body)`
    const reader = response.body.getReader()
    let body = Buffer.alloc(0), downloadTruncated = false
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      const remaining = MAX_RESPONSE_BYTES - body.length
      body = Buffer.concat([body, Buffer.from(value.subarray(0, Math.max(0, remaining)))])
      if (value.length > remaining) { downloadTruncated = true; break }
    }
    await reader.cancel()
    const decoded = new TextDecoder().decode(body)
    const output = truncateUtf8(decoded, MAX_OUTPUT_BYTES)
    const outputTruncated = Buffer.byteLength(decoded, "utf8") > MAX_OUTPUT_BYTES
    return `HTTP ${response.status}\n${output}${outputTruncated ? "\n[Model output truncated at 50 KiB.]" : ""}${downloadTruncated ? "\n[Response download stopped at 5 MiB.]" : ""}`
  },
}

function validateHttpUrl(input: string | URL): URL {
  const url = new URL(input)
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only HTTP and HTTPS URLs are supported")
  if (url.username || url.password) throw new Error("URLs must not include credentials")
  return url
}

function truncateUtf8(value: string, maxBytes: number) {
  let output = "", bytes = 0
  for (const character of value) {
    const size = Buffer.byteLength(character, "utf8")
    if (bytes + size > maxBytes) break
    output += character
    bytes += size
  }
  return output
}
