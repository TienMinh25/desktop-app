import { z } from "zod"

// GET /api/v2/projects?source=desktop-app&page=&page_size=
export const DesktopProjectsPageSchema = z.object({
  data: z.array(z.object({ id: z.number(), key: z.string(), name: z.string() })),
  metadata: z.object({
    code: z.literal("0000"),
    pagination: z.object({ has_next: z.boolean() }).loose(),
  }).loose(),
}).loose()

export type DesktopProjectsPage = z.input<typeof DesktopProjectsPageSchema>

// IPC payloads for projects and chat sessions (main <-> renderer)
export interface ProjectRow {
  id: string
  key: string
  name: string
  memberStatus: "active" | "removed"
  fetchedAt: number
}

export interface SessionRow {
  id: string
  projectId: string
  title: string
  lastPreview: string | null
  updatedAt: number
}

export interface SearchHit {
  id: string
  snippet: string | null
}

// syncedAt is null until the first successful sync of this app run
export interface ProjectsListResult {
  projects: ProjectRow[]
  syncedAt: number | null
  error: string | null
}
