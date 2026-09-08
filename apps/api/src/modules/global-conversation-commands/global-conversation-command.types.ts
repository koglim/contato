import type { GlobalConversationCommand } from "../conversation-commands/conversation-command.types.js";
import type { SearchConversationPendingSlot } from "../search-conversations/search-conversation.types.js";

export type GlobalConversationCommandInput = {
  customerId: string;
  command: GlobalConversationCommand;
};

export type ActiveGlobalConversation = {
  id: string;
  pendingSlot: SearchConversationPendingSlot;
};

export type GlobalConversationCommandOutcome =
  | { kind: "cancelled" }
  | { kind: "restarted" }
  | { kind: "help"; pendingSlot: SearchConversationPendingSlot | null }
  | { kind: "no_active_conversation" };

export interface GlobalConversationCommandRepository {
  findActiveByCustomerId(customerId: string): Promise<ActiveGlobalConversation | null>;
  cancelActiveByCustomerId(customerId: string): Promise<ActiveGlobalConversation | null>;
}

export interface GlobalConversationCommandService {
  execute(input: GlobalConversationCommandInput): Promise<GlobalConversationCommandOutcome>;
}
