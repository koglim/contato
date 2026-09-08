import type { GlobalConversationCommand } from "../conversation-commands/conversation-command.types.js";
import type { SelectShownMatchOutcome, SelectedMatchOutcome, SelectionMatchRecord, SelectionMatchRepository } from "../match-selection/match-selection.types.js";

export type SelectionCommandInput = {
  conversationId: string;
  customerId: string | null;
  searchRequestId: string | null;
  pendingSlot: "location" | "service" | "selection" | null;
  rawText: string;
  lastMessageText: string;
  selectionKey: string;
  limit?: number;
};

export type SelectionCommandOutcome =
  | SelectShownMatchOutcome
  | { kind: "global_command"; command: GlobalConversationCommand }
  | { kind: "invalid_selection"; requestedPosition: number; visibleMatchCount: number }
  | { kind: "ambiguous_selection"; options: Array<{ position: number; professionalDisplayName: string }> }
  | { kind: "show_more_requested"; hasMore: boolean; shownMatchCount: number; matches?: SelectionMatchRecord[] }
  | { kind: "not_command" }
  | {
    kind: "invalid_context";
    reason: "missing_conversation_id" | "missing_customer_id" | "missing_search_request_id" | "not_awaiting_selection";
  };

export interface SelectionCommandService {
  process(input: SelectionCommandInput): Promise<SelectionCommandOutcome>;
  recoverSelection(customerId: string, selectionKey: string): Promise<SelectedMatchOutcome | null>;
}

export type SelectionCommandDependencies = {
  selectionMatchRepository: SelectionMatchRepository;
};
