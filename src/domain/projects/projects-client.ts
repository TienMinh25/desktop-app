import { DesktopProjectsSchema, type ProjectRow } from "../../contracts/projects"
import type { BackendHttpClient } from "../../infrastructure/http/backend-http-client"

export async function fetchProjects(http: BackendHttpClient): Promise<Pick<ProjectRow, "id" | "name">[]> {
  const body = await http.getJson<unknown>("/api/v2/projects?source=desktop-app", {}, AbortSignal.timeout(15_000))
  const parsed = DesktopProjectsSchema.safeParse(body)
  if (!parsed.success) throw new Error("Backend returned no valid project list")
  return parsed.data.data.map((project) => ({ id: String(project.project_id), name: project.project_name }))
}
