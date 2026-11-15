import type { ResponseInputItem } from "../../domain/chat/types"
import type { ConversationStore } from "./conversation-store"

export class InMemoryConversationStore implements ConversationStore {
  private readonly sessions = new Map<string, ResponseInputItem[]>()

  async getMessages(sessionId: string): Promise<ResponseInputItem[]> {
    return structuredClone(this.sessions.get(sessionId) ?? [])
  }

  async saveMessages(sessionId: string, messages: ResponseInputItem[]): Promise<void> {
    this.sessions.set(sessionId, structuredClone(messages))
  }
}
