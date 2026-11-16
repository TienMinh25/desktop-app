import type { TodoInput, TodoItem } from "../../contracts/todos"

interface TodoScopeState {
  sessionId: string
  todos: TodoItem[]
}

export class TodoStateStore {
  private readonly scopes = new Map<string, TodoScopeState>()

  get(scopeId: string): TodoItem[] {
    return structuredClone(this.scopes.get(scopeId)?.todos ?? [])
  }

  upsert(scopeId: string, sessionId: string, updates: TodoInput[]): TodoItem[] {
    const state = this.scopes.get(scopeId) ?? { sessionId, todos: [] }
    if (state.sessionId !== sessionId) throw new Error("Todo scope is already owned by another session")

    for (const update of updates) {
      const existingIndex = update.id
        ? state.todos.findIndex((todo) => todo.id === update.id)
        : state.todos.findIndex((todo) => todo.content === update.content)
      const id = update.id ?? (existingIndex >= 0 ? state.todos[existingIndex]?.id : undefined) ?? crypto.randomUUID()
      const item = { id, content: update.content, status: update.status }
      if (existingIndex >= 0) state.todos[existingIndex] = item
      else state.todos.push(item)
    }

    this.scopes.set(scopeId, state)
    return structuredClone(state.todos)
  }

  clearRequest(scopeId: string): void {
    if (scopeId.startsWith("request:")) this.scopes.delete(scopeId)
  }

  clearSession(sessionId: string): void {
    for (const [scopeId, state] of this.scopes) {
      if (state.sessionId === sessionId) this.scopes.delete(scopeId)
    }
  }
}
