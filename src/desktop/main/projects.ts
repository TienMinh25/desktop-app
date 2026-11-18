import { DesktopProjectsSchema } from "../../contracts/projects"
import type { BackendHttpClient } from "../../infrastructure/http/backend-http-client"

// Backend puts the numeric user id in `sub`, there is no ldap claim
export function userIdFromJwt(token: string): string {
  const payload = token.split(".")[1]
  const sub: unknown = payload ? JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub : undefined
  if (typeof sub !== "string" || !/^\d+$/.test(sub)) throw new Error("Access token has no user id (sub claim)")
  return sub
}

export async function fetchProjects(http: BackendHttpClient): Promise<Array<{ id: string; name: string }>> {
  const body = await http.getJson<unknown>("/api/v2/projects?source=desktop-app", {}, AbortSignal.timeout(15_000))
  const parsed = DesktopProjectsSchema.safeParse(body)
  if (!parsed.success) throw new Error("Backend returned no valid project list")
  return parsed.data.data.map((project) => ({ id: String(project.project_id), name: project.project_name }))
}
