import { expect, test } from "bun:test"
import { Headers, Response } from "undici"
import { BackendHttpClient } from "../../../src/infrastructure/http/backend-http-client"
import { fetchProjects } from "../../../src/domain/projects/projects-client"

const tokenProvider = {
  async getAccessToken() { return "login-token" },
  async refreshAccessToken() { return "refreshed-token" },
  async expireSession() {},
}

test("fetchProjects sends the login token and maps the desktop project list", async () => {
  const seen: Array<{ url: string; authorization: string | null }> = []
  const http = new BackendHttpClient("https://company.test", tokenProvider, undefined, async (input, init) => {
    seen.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") })
    return new Response(JSON.stringify({ data: [{ project_id: 7, project_key: "CRM", project_name: "CRM", status: "", organization_unit_id: 1 }], metadata: { code: "SUCCESS" } }), { status: 200, headers: { "content-type": "application/json" } })
  })
  expect(await fetchProjects(http)).toEqual([{ id: "7", name: "CRM" }])
  expect(seen).toEqual([{ url: "https://company.test/api/v2/projects?source=desktop-app", authorization: "Bearer login-token" }])
}, 30_000) // BackendHttpClient reads the Windows cert store via PowerShell on first use
