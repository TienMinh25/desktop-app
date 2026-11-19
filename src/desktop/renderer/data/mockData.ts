export interface ProjectItem {
  id: string
  name: string
  key: string
  folder: string
}

export interface ChatSession {
  id: string
  projectId: string
  title: string
  hasHistory: boolean
  projectOrder: number
}

