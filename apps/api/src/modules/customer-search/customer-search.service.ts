import type { CustomerSearchMessageResponse } from "@contatocerto/shared";
import { parseGlobalConversationCommand } from "../conversation-commands/conversation-command.parser.js";
import { mapGlobalConversationCommandOutcome } from "../global-conversation-commands/global-conversation-message.mapper.js";
import type { GlobalConversationCommandService } from "../global-conversation-commands/global-conversation-command.types.js";
import { mapSelectionCommandOutcome } from "../selection-message/selection-message.mapper.js";
import type { SelectionCommandService } from "../selection-command/selection-command.types.js";
import type { CustomerRepository } from "../customers/customer.repository.js";
import type { SearchConversationRepository, SearchConversationService } from "../search-conversations/search-conversation.types.js";
import type { CustomerSearchRouteInput, CustomerSearchRouteOutcome, CustomerSearchRouter } from "./customer-search.types.js";

function isActiveConversationConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === "23505"
    && "constraint" in error
    && (error as { constraint?: unknown }).constraint === "search_conversations_one_active_per_customer_idx";
}

function searchRequestIdFrom(response: CustomerSearchMessageResponse): string | null {
  if (response.route === "selection" || response.route === "global_command") return null;
  const result = response.conversation.result;
  return "matching" in result ? result.matching?.search_request_id ?? null : result.orchestration?.matching?.search_request_id ?? null;
}

function presentedMatchIdsFrom(response: CustomerSearchMessageResponse): string[] {
  if (response.route === "selection" || response.route === "global_command") return [];
  const result = response.conversation.result;
  if (result.status !== "matched") return [];
  const matching = "matching" in result ? result.matching : result.orchestration.matching;
  return matching?.matches.map((match) => match.match_id) ?? [];
}

export class DefaultCustomerSearchRouter implements CustomerSearchRouter {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly conversations: SearchConversationRepository,
    private readonly searchConversationService: SearchConversationService,
    private readonly selectionCommandService: SelectionCommandService,
    private readonly globalConversationCommandService: GlobalConversationCommandService,
  ) {}

  async route(input: CustomerSearchRouteInput): Promise<CustomerSearchRouteOutcome> {
    const customer = await this.customers.findOrCreateByPhoneE164(input.phone_e164);
    const globalCommand = parseGlobalConversationCommand(input.raw_text);
    if (globalCommand) {
      const outcome = await this.globalConversationCommandService.execute({ customerId: customer.id, command: globalCommand });
      return { kind: "response", response: { customer_id: customer.id, route: "global_command", result: mapGlobalConversationCommandOutcome(outcome) }, conversationId: null, searchRequestId: null, presentedMatchIds: [] };
    }
    if (input.selectionKey) {
      const recovered = await this.selectionCommandService.recoverSelection(customer.id, input.selectionKey);
      if (recovered) return { kind: "response", response: { customer_id: customer.id, route: "selection", result: mapSelectionCommandOutcome(recovered) }, conversationId: null, searchRequestId: null, presentedMatchIds: [] };
    }
    await this.conversations.expireStaleForCustomer(customer.id);
    const activeConversation = await this.conversations.findActiveByCustomerId(customer.id);
    if (activeConversation?.pendingSlot === "selection") {
      if (!input.selectionKey) return { kind: "selection_idempotency_key_required" };
      const outcome = await this.selectionCommandService.process({ conversationId: activeConversation.id, customerId: customer.id, searchRequestId: activeConversation.searchRequestId, pendingSlot: "selection", rawText: input.raw_text, lastMessageText: input.raw_text, selectionKey: input.selectionKey, limit: activeConversation.limitValue });
      if (outcome.kind === "show_more_requested" && outcome.hasMore && !(outcome.matches?.length)) {
        return { kind: "selection_show_more_pending" };
      }
      return { kind: "response", response: { customer_id: customer.id, route: "selection", result: mapSelectionCommandOutcome(outcome) }, conversationId: activeConversation.id, searchRequestId: activeConversation.searchRequestId, presentedMatchIds: outcome.kind === "show_more_requested" ? (outcome.matches ?? []).map((match) => match.matchId) : [] };
    }
    if (activeConversation) {
      const outcome = await this.searchConversationService.continueConversation(activeConversation.id, { raw_text: input.raw_text });
      if (outcome.kind === "conversation_processing" || outcome.kind === "service_unavailable") return outcome;
      if (outcome.kind !== "response") return { kind: "customer_conversation_conflict" };
      const response: CustomerSearchMessageResponse = { customer_id: customer.id, route: "continued", conversation: outcome.response };
      return { kind: "response", response, conversationId: outcome.response.conversation_id, searchRequestId: searchRequestIdFrom(response), presentedMatchIds: presentedMatchIdsFrom(response) };
    }
    try {
      const outcome = await this.searchConversationService.start({ raw_text: input.raw_text, country_code: input.country_code, limit: input.limit }, { customerId: customer.id });
      if (outcome.kind === "service_unavailable") return outcome;
      const response: CustomerSearchMessageResponse = { customer_id: customer.id, route: "started", conversation: outcome.response };
      return { kind: "response", response, conversationId: outcome.response.conversation_id, searchRequestId: searchRequestIdFrom(response), presentedMatchIds: presentedMatchIdsFrom(response) };
    } catch (error) {
      if (isActiveConversationConflict(error)) return { kind: "customer_conversation_conflict" };
      throw error;
    }
  }
}
