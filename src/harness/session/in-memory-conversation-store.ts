import type { ChatMessage } from "../../domain/chat/types"
import type { ConversationStore } from "./conversation-store"

export class InMemoryConversationStore implements ConversationStore {
  private readonly sessions = new Map<string, ChatMessage[]>()

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    return structuredClone(this.sessions.get(sessionId) ?? [])
  }

  async saveMessages(sessionId: string, messages: ChatMessage[]): Promise<void> {
    this.sessions.set(sessionId, structuredClone(messages))
  }
}
