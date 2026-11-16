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

it("follows safe redirects and requires permission for each redirect destination", async () => {
  const testContext = await createToolTestContext()
  const destination = await serve((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" })
    response.end("redirect destination")
  })
  const intermediate = await serve((_request, response) => { response.writeHead(301, { location: destination.url }); response.end() })
  const redirect = await serve((_request, response) => { response.writeHead(302, { location: intermediate.url }); response.end() })
  const binary = await serve((_request, response) => { response.writeHead(200, { "content-type": "application/octet-stream" }); response.end("binary") })
  try {
    await expect(webfetchTool.prepare!({ url: "file:///etc/passwd" }, testContext.context)).rejects.toThrow("Only HTTP and HTTPS")
    const redirectPrepared = await webfetchTool.prepare!({ url: redirect.url }, testContext.context)
    expect(await webfetchTool.execute({ url: redirect.url }, testContext.context, redirectPrepared.data)).toBe("HTTP 200\nredirect destination")
    expect(testContext.permissionRequirements.map((requirement) => requirement.resource)).toContain(`${intermediate.url}/`)
    expect(testContext.permissionRequirements.map((requirement) => requirement.resource)).toContain(`${destination.url}/`)
    const binaryPrepared = await webfetchTool.prepare!({ url: binary.url }, testContext.context)
    await expect(webfetchTool.execute({ url: binary.url }, testContext.context, binaryPrepared.data)).rejects.toThrow("Unsupported content type")
  } finally {
    await Promise.all([redirect.close(), intermediate.close(), destination.close(), binary.close()])
    await testContext.cleanup()
  }
})

it("rejects redirects to unsupported schemes or URLs containing credentials", async () => {
  const testContext = await createToolTestContext()
  const redirect = await serve((_request, response) => { response.writeHead(302, { location: "file:///etc/passwd" }); response.end() })
  const credentialRedirect = await serve((_request, response) => { response.writeHead(302, { location: "https://user:pass@example.test/" }); response.end() })
  try {
    const prepared = await webfetchTool.prepare!({ url: redirect.url }, testContext.context)
    await expect(webfetchTool.execute({ url: redirect.url }, testContext.context, prepared.data)).rejects.toThrow("Only HTTP and HTTPS")

    const credentialPrepared = await webfetchTool.prepare!({ url: credentialRedirect.url }, testContext.context)
    await expect(webfetchTool.execute({ url: credentialRedirect.url }, testContext.context, credentialPrepared.data)).rejects.toThrow("must not include credentials")
    await expect(webfetchTool.prepare!({ url: "https://user:pass@example.test/" }, testContext.context)).rejects.toThrow("must not include credentials")
  } finally {
    await Promise.all([redirect.close(), credentialRedirect.close()])
    await testContext.cleanup()
  }

})

it("stops after ten redirects", async () => {
  const testContext = await createToolTestContext()
  let requests = 0
  const redirect = await serve((_request, response) => {
    requests += 1
    response.writeHead(302, { location: redirect.url })
    response.end()
  })
  try {
    const prepared = await webfetchTool.prepare!({ url: redirect.url }, testContext.context)
    await expect(webfetchTool.execute({ url: redirect.url }, testContext.context, prepared.data)).rejects.toThrow("Too many redirects (maximum 10)")
    expect(requests).toBe(11)
  } finally {
    await redirect.close()
    await testContext.cleanup()
  }
})

it("truncates large text responses to the 50 KiB model output limit", async () => {
  const testContext = await createToolTestContext()
  const server = await serve((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" })
    response.end("x".repeat(60_000))
  })
  try {
    const prepared = await webfetchTool.prepare!({ url: server.url }, testContext.context)
    const result = await webfetchTool.execute({ url: server.url }, testContext.context, prepared.data)
    if (typeof result !== "string") throw new Error("Expected text output")
    expect(Buffer.byteLength(result, "utf8")).toBeLessThan(50 * 1024 + 100)
    expect(result).toContain("[Model output truncated at 50 KiB.]")
  } finally {
    await server.close()
    await testContext.cleanup()
  }
})
