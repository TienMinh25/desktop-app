import { expect, it } from "bun:test"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { webfetchTool } from "../../../src/harness/tools/webfetch-tool"
import { createToolTestContext } from "./tool-test-context"

async function serve(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) },
  }
}

it("requires approval, fetches text, and caps returned content", async () => {
  const testContext = await createToolTestContext()
  const server = await serve((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" })
    response.end("hello from local server")
  })
  try {
    const prepared = await webfetchTool.prepare!({ url: server.url }, testContext.context)
    expect(prepared.permissionRequests[0]?.tool).toBe("webfetch")
    expect(await webfetchTool.execute({ url: server.url }, testContext.context, prepared.data)).toBe("HTTP 200\nhello from local server")
  } finally {
    await server.close()
    await testContext.cleanup()
  }
})

it("rejects redirects, unsupported schemes, and non-text responses", async () => {
  const testContext = await createToolTestContext()
  const redirect = await serve((_request, response) => { response.writeHead(302, { location: "http://example.test/" }); response.end() })
  const binary = await serve((_request, response) => { response.writeHead(200, { "content-type": "application/octet-stream" }); response.end("binary") })
  try {
    await expect(webfetchTool.prepare!({ url: "file:///etc/passwd" }, testContext.context)).rejects.toThrow("Only HTTP and HTTPS")
    const redirectPrepared = await webfetchTool.prepare!({ url: redirect.url }, testContext.context)
    await expect(webfetchTool.execute({ url: redirect.url }, testContext.context, redirectPrepared.data)).rejects.toThrow("Redirects are not followed")
    const binaryPrepared = await webfetchTool.prepare!({ url: binary.url }, testContext.context)
    await expect(webfetchTool.execute({ url: binary.url }, testContext.context, binaryPrepared.data)).rejects.toThrow("Unsupported content type")
  } finally {
    await Promise.all([redirect.close(), binary.close()])
    await testContext.cleanup()
  }
})

it("truncates large text responses at the configured response limit", async () => {
  const testContext = await createToolTestContext()
  const server = await serve((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" })
    response.end("x".repeat(31_000))
  })
  try {
    const prepared = await webfetchTool.prepare!({ url: server.url }, testContext.context)
    const result = await webfetchTool.execute({ url: server.url }, testContext.context, prepared.data)
    expect(result.length).toBeLessThan(30_100)
    expect(result).toContain("[truncated at 30 KB]")
  } finally {
    await server.close()
    await testContext.cleanup()
  }
})
