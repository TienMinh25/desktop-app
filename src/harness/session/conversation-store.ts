import type { ChatMessage } from "../../domain/chat/types"

/** Storage boundary. A future SQLite adapter can implement this without changing the agent. */
export interface ConversationStore {
  getMessages(sessionId: string): Promise<ChatMessage[]>
  saveMessages(sessionId: string, messages: ChatMessage[]): Promise<void>
}
