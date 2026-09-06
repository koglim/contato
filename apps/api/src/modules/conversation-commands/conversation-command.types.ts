export type GlobalConversationCommand =
  | { kind: "cancel" }
  | { kind: "restart" }
  | { kind: "help" };

export type SelectionConversationCommand =
  | { kind: "show_more" }
  | { kind: "select_match"; position: number };
