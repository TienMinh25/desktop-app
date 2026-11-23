import { z } from "zod"
import { API_RESPONSE_CODES, ApiMetadataSchema, ApiPaginationSchema } from "./api-response"

// GET /api/v2/projects?source=desktop-app&page=&page_size=
const DesktopProjectSchema = z.object({ id: z.number(), key: z.string(), name: z.string(), is_active: z.boolean() })

// Pagination is required here, the shared metadata schema has it optional
export const DesktopProjectsPageSchema = z.object({
  data: z.array(DesktopProjectSchema),
  metadata: ApiMetadataSchema.extend({ code: z.literal(API_RESPONSE_CODES.SUCCESS), pagination: ApiPaginationSchema }),
}).loose()

export type DesktopProjectsPage = z.input<typeof DesktopProjectsPageSchema>

// IPC payloads for projects and chat sessions (main <-> renderer)
export interface ProjectRow {
  id: string
  key: string
  name: string
  // false once the backend list no longer has the project, its chats stay in the DB
  isAssigned: boolean
  fetchedAt: number
}

export interface SessionRow {
  id: string
  projectId: string
  title: string
  lastPreview: string | null
  updatedAt: number
}

// syncedAt is null until the first successful sync of this app run
export interface ProjectsListResult {
  projects: ProjectRow[]
  syncedAt: number | null
  error: string | null
}

// Ids of assigned projects whose name matches and sessions whose title matches
export interface SidebarSearchResult {
  projectIds: string[]
  sessionIds: string[]
}
