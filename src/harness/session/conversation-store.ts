import type { ResponseInputItem } from "../../domain/chat/types"

/** Storage boundary. A future SQLite adapter can implement this without changing the agent. */
export interface ConversationStore {
  getMessages(sessionId: string): Promise<ResponseInputItem[]>
  saveMessages(sessionId: string, messages: ResponseInputItem[]): Promise<void>
}
