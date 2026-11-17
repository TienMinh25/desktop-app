export interface ProjectItem {
  id: string
  name: string
  key: string
  folder: string
}

export interface ChatSession {
  id: number
  projectId: string
  title: string
  hasHistory: boolean
  projectOrder: number
}

export const PROJECT_CATALOG: ProjectItem[] = [
  {
    id: "desktop",
    name: "C-CodeX Desktop Phase 2",
    key: "CCODEX-DT",
    folder: "C:/Users/ntquynh8/Projects/C-CodeX-Desktop",
  },
  {
    id: "core-banking",
    name: "CMC Core Banking",
    key: "CMC-CORE",
    folder: "C:/Users/ntquynh8/Workspace/CoreBanking",
  },
]

export const MOCK_ASSIGNED_PROJECTS: Record<string, string[]> = {
  ntquynh8: ["desktop", "core-banking"],
  ntquynh9: [],
}

export const INITIAL_SESSIONS: ChatSession[] = [
  {
    id: 2,
    projectId: "desktop",
    title: "POA Permission Restructuring",
    hasHistory: false,
    projectOrder: 1,
  },
  {
    id: 1,
    projectId: "desktop",
    title: "Fix webhook test flakiness",
    hasHistory: true,
    projectOrder: 2,
  },
  {
    id: 3,
    projectId: "core-banking",
    title: "Coding Agent Sandbox Design",
    hasHistory: false,
    projectOrder: 1,
  },
]
