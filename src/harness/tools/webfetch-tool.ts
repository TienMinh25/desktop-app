import type { HarnessTool } from "../agent/tool-registry"
import { definition, objectArgs, permissionRequest, stringArg } from "./tool-utils"

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const MAX_OUTPUT_BYTES = 50 * 1024

export const webfetchTool: HarnessTool = {
  definition: definition("webfetch", "Fetch text-like content from an HTTP or HTTPS URL. Downloads at most 5 MiB and returns at most 50 KiB to the model. Requires approval.", { url: { type: "string" } }, ["url"]),
  async prepare(value) {
    const url = new URL(stringArg(objectArgs(value), "url"))
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only HTTP and HTTPS URLs are supported")
    return { permissionRequests: [permissionRequest("webfetch", "fetch a URL", url.href, true)], data: url.href }
  },
  async execute(_value, _context, prepared) {
    const url = new URL(prepared as string)
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30_000), headers: { "user-agent": "DesktopHarness/0.1" } })
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      throw new Error("Redirects are not followed; approve and fetch the destination URL directly")
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
