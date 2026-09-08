import { routeConversationCommand } from "../conversation-commands/conversation-command.router.js";
import { resolveProfessionalSelection } from "./professional-selection.resolver.js";
import type {
  SelectionCommandDependencies,
  SelectionCommandInput,
  SelectionCommandOutcome,
  SelectionCommandService,
} from "./selection-command.types.js";

function invalidContext(input: SelectionCommandInput): SelectionCommandOutcome | null {
  if (!input.conversationId) return { kind: "invalid_context", reason: "missing_conversation_id" };
  if (!input.customerId) return { kind: "invalid_context", reason: "missing_customer_id" };
  if (!input.searchRequestId) return { kind: "invalid_context", reason: "missing_search_request_id" };
  if (input.pendingSlot !== "selection") return { kind: "invalid_context", reason: "not_awaiting_selection" };
  return null;
}

export class DefaultSelectionCommandService implements SelectionCommandService {
  constructor(private readonly dependencies: SelectionCommandDependencies) {}

  async process(input: SelectionCommandInput): Promise<SelectionCommandOutcome> {
    const contextError = invalidContext(input);
    if (contextError) return contextError;

    const state = await this.dependencies.selectionMatchRepository.getState(input.searchRequestId!);
    const routed = routeConversationCommand(input.rawText, {
      kind: "awaiting_selection",
      visibleMatchCount: state.shownMatchCount,
    });

    switch (routed.kind) {
      case "global_command":
        return routed;
      case "invalid_selection":
        return routed;
      case "not_command":
        {
          const resolution = resolveProfessionalSelection(
            input.rawText,
            await this.dependencies.selectionMatchRepository.listShown(input.searchRequestId!),
          );
          if (resolution.kind === "selected") {
            return this.dependencies.selectionMatchRepository.selectShownMatch({
              conversationId: input.conversationId,
              customerId: input.customerId!,
              searchRequestId: input.searchRequestId!,
              position: resolution.position,
              lastMessageText: input.lastMessageText,
              selectionKey: input.selectionKey,
            });
          }
          if (resolution.kind === "ambiguous") return { kind: "ambiguous_selection", options: resolution.options };
          return routed;
        }
      case "selection_command":
        if (routed.command.kind === "show_more") {
          const matches = state.hasMore
            ? await this.dependencies.selectionMatchRepository.listNextUnshown(input.searchRequestId!, input.limit ?? 3)
            : [];
          const result = {
            kind: "show_more_requested",
            hasMore: state.hasMore,
            shownMatchCount: state.shownMatchCount,
            ...(matches.length > 0 ? { matches } : {}),
          } as SelectionCommandOutcome;
          return result;
        }
        return this.dependencies.selectionMatchRepository.selectShownMatch({
          conversationId: input.conversationId,
          customerId: input.customerId!,
          searchRequestId: input.searchRequestId!,
          position: routed.command.position,
          lastMessageText: input.lastMessageText,
          selectionKey: input.selectionKey,
        });
    }
  }

  async recoverSelection(customerId: string, selectionKey: string) {
    return this.dependencies.selectionMatchRepository.findSelectedByCustomerAndSelectionKey(customerId, selectionKey);
  }
}
