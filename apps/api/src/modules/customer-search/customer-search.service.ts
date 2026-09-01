import type { CustomerSearchMessageInput } from "@contatocerto/shared";
import type { CustomerRepository } from "../customers/customer.repository.js";
import type { SearchConversationRepository, SearchConversationService } from "../search-conversations/search-conversation.types.js";
import type { CustomerSearchRouteOutcome, CustomerSearchRouter } from "./customer-search.types.js";

function isActiveConversationConflict(error: unknown) {
  return typeof error === "object" && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "23505"
    && "constraint" in error
    && (error as { constraint?: unknown }).constraint === "search_conversations_one_active_per_customer_idx";
}

export class DefaultCustomerSearchRouter implements CustomerSearchRouter {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly conversations: SearchConversationRepository,
    private readonly searchConversationService: SearchConversationService,
  ) {}

  async route(input: CustomerSearchMessageInput): Promise<CustomerSearchRouteOutcome> {
    const customer = await this.customers.findOrCreateByPhoneE164(input.phone_e164);
    await this.conversations.expireStaleForCustomer(customer.id);
    const activeConversation = await this.conversations.findActiveByCustomerId(customer.id);

    if (activeConversation) {
      const outcome = await this.searchConversationService.continueConversation(activeConversation.id, {
        raw_text: input.raw_text,
      });
      if (outcome.kind === "conversation_processing") return outcome;
      if (outcome.kind === "service_unavailable") return outcome;
      if (outcome.kind !== "response") return { kind: "customer_conversation_conflict" };
      return {
        kind: "response",
        response: { customer_id: customer.id, route: "continued", conversation: outcome.response },
      };
    }

    try {
      const outcome = await this.searchConversationService.start({
        raw_text: input.raw_text,
        country_code: input.country_code,
        limit: input.limit,
      }, { customerId: customer.id });
      if (outcome.kind === "service_unavailable") return outcome;
      return {
        kind: "response",
        response: { customer_id: customer.id, route: "started", conversation: outcome.response },
      };
    } catch (error) {
      if (isActiveConversationConflict(error)) return { kind: "customer_conversation_conflict" };
      throw error;
    }
  }
}
