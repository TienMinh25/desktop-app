export type TodoStatus = "pending" | "in_progress" | "completed"

export interface TodoItem {
  id: string
  content: string
  status: TodoStatus
}

export type TodoInput = Omit<TodoItem, "id"> & { id?: string }
