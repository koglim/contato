export type GlobalConversationCommand =
  | { kind: "cancel" }
  | { kind: "restart" }
  | { kind: "help" };

export type SelectionConversationCommand =
  | { kind: "show_more" }
  | { kind: "select_match"; position: number };

export type ConversationCommandState =
  | { kind: "awaiting_service" }
  | { kind: "awaiting_location" }
  | { kind: "awaiting_selection"; visibleMatchCount: number };

export type ConversationCommandRouteResult =
  | { kind: "global_command"; command: GlobalConversationCommand }
  | { kind: "selection_command"; command: SelectionConversationCommand }
  | { kind: "invalid_selection"; requestedPosition: number; visibleMatchCount: number }
  | { kind: "not_command" };
