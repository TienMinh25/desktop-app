import { expect, test } from "bun:test"
import { Headers, Response } from "undici"
import { BackendHttpClient } from "../../../src/infrastructure/http/backend-http-client"
import { fetchProjects } from "../../../src/domain/projects/projects-client"

const tokenProvider = {
  async getAccessToken() { return "login-token" },
  async refreshAccessToken() { return "refreshed-token" },
  async expireSession() {},
}

// Shape of the real GET /api/v2/projects?source=desktop-app response
function page(projects: Array<{ id: number; key: string; name: string }>, hasNext: boolean, code = "0000") {
  return {
    data: projects.map((project) => ({ ...project, organization_unit_id: 25 })),
    metadata: { code, pagination: { page: 1, limit: 20, total_items: projects.length, total_pages: 1, has_next: hasNext, has_previous: false } },
  }
}

function backend(pages: object[]) {
  const seen: Array<{ url: string; authorization: string | null }> = []
  const http = new BackendHttpClient("https://company.test", tokenProvider, undefined, async (input, init) => {
    seen.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") })
    return new Response(JSON.stringify(pages[seen.length - 1]), { status: 200, headers: { "content-type": "application/json" } })
  })
  return { http, seen }
}

test("fetchProjects sends the login token and walks every page", async () => {
  const { http, seen } = backend([
    page([{ id: 42, key: "P-1460", name: "Innocellent" }], true),
    page([{ id: 7, key: "P-7", name: "CRM" }], false),
  ])
  expect(await fetchProjects(http)).toEqual([
    { id: "42", key: "P-1460", name: "Innocellent" },
    { id: "7", key: "P-7", name: "CRM" },
  ])
  expect(seen).toEqual([
    { url: "https://company.test/api/v2/projects?source=desktop-app&page=1&page_size=20", authorization: "Bearer login-token" },
    { url: "https://company.test/api/v2/projects?source=desktop-app&page=2&page_size=20", authorization: "Bearer login-token" },
  ])
}, 30_000) // BackendHttpClient reads the Windows cert store via PowerShell on first use

test("fetchProjects rejects a response whose code is not 0000", async () => {
  const { http } = backend([page([{ id: 42, key: "P-1460", name: "Innocellent" }], false, "4001")])
  await expect(fetchProjects(http)).rejects.toThrow("Backend returned no valid project list")
})
