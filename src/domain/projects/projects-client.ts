import { DesktopProjectsPageSchema, type DesktopProjectsPage, type ProjectRow } from "../../contracts/projects"
import type { BackendHttpClient } from "../../infrastructure/http/backend-http-client"

const PAGE_SIZE = 50
// Stops a backend that always answers has_next = true
const MAX_PAGES = 50

export async function fetchProjects(http: BackendHttpClient): Promise<Pick<ProjectRow, "id" | "key" | "name">[]> {
  const projects: Pick<ProjectRow, "id" | "key" | "name">[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await http.getJson<DesktopProjectsPage>(
      `/api/v2/projects?source=desktop-app&page=${page}&page_size=${PAGE_SIZE}`, {}, AbortSignal.timeout(15_000))
    // getJson only casts, the schema is the real check
    const parsed = DesktopProjectsPageSchema.safeParse(body)
    if (!parsed.success) throw new Error("Backend returned no valid project list")
    // Inactive projects are left out so the sync marks them unassigned and keeps their chats
    const active = parsed.data.data.filter((project) => project.is_active)
    projects.push(...active.map((project) => ({ id: String(project.id), key: project.key, name: project.name })))
    if (!parsed.data.metadata.pagination.has_next) return projects
  }
  throw new Error(`Project list has more than ${MAX_PAGES} pages`)
}
