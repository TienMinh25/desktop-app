import { z } from "zod"

// GET /api/v2/projects?source=desktop-app
export const DesktopProjectsSchema = z.object({
  data: z.array(z.object({ project_id: z.number(), project_name: z.string() })),
})

// IPC payloads for projects and chat sessions (main <-> renderer)
export interface ProjectRow {
  id: string
  name: string
  memberStatus: "active" | "removed"
  fetchedAt: number
}

export interface SessionRow {
  id: string
  title: string
  lastPreview: string | null
  updatedAt: number
}

export interface SearchHit {
  id: string
  snippet: string | null
}

export interface ProjectsListResult {
  projects: ProjectRow[]
  error: string | null
}
