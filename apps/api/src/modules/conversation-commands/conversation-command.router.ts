import {
  parseGlobalConversationCommand,
  parseSelectionConversationCommand,
} from "./conversation-command.parser.js";
import type {
  ConversationCommandRouteResult,
  ConversationCommandState,
} from "./conversation-command.types.js";

export function routeConversationCommand(
  rawText: string,
  state: ConversationCommandState,
): ConversationCommandRouteResult {
  const globalCommand = parseGlobalConversationCommand(rawText);
  if (globalCommand) return { kind: "global_command", command: globalCommand };

  if (state.kind !== "awaiting_selection") return { kind: "not_command" };

  const selectionCommand = parseSelectionConversationCommand(rawText);
  if (!selectionCommand) return { kind: "not_command" };
  if (selectionCommand.kind === "show_more") {
    return { kind: "selection_command", command: selectionCommand };
  }
  if (selectionCommand.position <= state.visibleMatchCount) {
    return { kind: "selection_command", command: selectionCommand };
  }
  return {
    kind: "invalid_selection",
    requestedPosition: selectionCommand.position,
    visibleMatchCount: state.visibleMatchCount,
  };
}
