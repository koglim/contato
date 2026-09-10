import { randomUUID } from "node:crypto";
import { customerSearchMessageResponseSchema, opportunityMessageSchema, contextualMessageSchema, type ChannelInboundMessageInput } from "@contatocerto/shared";
import type { ContextualInboxHandler } from "../contextual-conversation/contextual.service.js";
import type { ProfessionalOpportunityService } from "../professional-opportunity/professional-opportunity.service.js";
import { GeocodingProviderError } from "../location-resolution/location-resolution.types.js";
import type { CustomerSearchRouter } from "../customer-search/customer-search.types.js";
import type { ChannelInboxConfig } from "../../config/channel-inbox.js";
import type { MessagePresenter } from "../message-presentation/message-presentation.types.js";
import { presentSelectionMessage } from "../selection-message/selection-message.presenter.js";
import { presentGlobalConversationMessage } from "../global-conversation-commands/global-conversation-message.presenter.js";
import type { ChannelOutboundMessageRepository } from "../channel-outbox/channel-outbox.types.js";
import { MatchReservationConflictError } from "../channel-outbox/channel-outbox.repository.js";
import type {
  ChannelInboxOutcome,
  ChannelInboxService,
  ChannelInboundMessageRecord,
  ChannelInboundMessageRepository,
} from "./channel-inbox.types.js";

function searchRequestIdFrom(record: ReturnType<typeof customerSearchMessageResponseSchema.parse>): string | null {
  if (record.route === "selection" || record.route === "global_command") return null;
  const result = record.conversation.result;
  if ("matching" in result) return result.matching?.search_request_id ?? null;
  return result.orchestration?.matching?.search_request_id ?? null;
}

function presentedMatchIdsFrom(record: ReturnType<typeof customerSearchMessageResponseSchema.parse>): string[] {
  if (record.route === "global_command") return [];
  if (record.route === "selection") return [];
  const result = record.conversation.result;
  if (result.status !== "matched") return [];
  const matching = "matching" in result ? result.matching : result.orchestration.matching;
  return matching?.matches.map((match) => match.match_id) ?? [];
}

function errorCodeFor(error: unknown) {
  if (!(error instanceof GeocodingProviderError)) return "internal_error";
  if (error.kind === "rate_limited") return "geocoding_rate_limited";
  if (error.kind === "unavailable") return "geocoding_unavailable";
  return "geocoding_provider_error";
}

function publicResult(result: ReturnType<typeof customerSearchMessageResponseSchema.parse>) {
  if (result.route === "selection" || result.route === "global_command") return result;
  const sanitized = JSON.parse(JSON.stringify(result)) as {
    conversation: { result: Record<string, unknown> };
  } & typeof result;
  const interpretation = sanitized.conversation.result.interpretation;
  if (typeof interpretation === "object" && interpretation !== null) {
    delete (interpretation as Record<string, unknown>).raw_text;
    delete (interpretation as Record<string, unknown>).service_text;
  }
  return sanitized;
}

function presentRouteResult(result: ReturnType<typeof customerSearchMessageResponseSchema.parse>, searchPresenter: MessagePresenter): string {
  if (result.route === "selection") {
    const text = presentSelectionMessage(result.result);
    if (!text) throw new Error("Selection action cannot create an outbound response");
    return text;
  }
  if (result.route === "global_command") return presentGlobalConversationMessage(result.result);
  return searchPresenter.present(result);
}

function sameInboundPayload(record: ChannelInboundMessageRecord, input: ChannelInboundMessageInput) {
  return record.phoneE164 === input.phone_e164
    && record.rawText === input.raw_text
    && record.countryCode === input.country_code
    && record.limitValue === input.limit;
}

export class DefaultChannelInboxService implements ChannelInboxService {
  constructor(
    private readonly repository: ChannelInboundMessageRepository,
    private readonly customerSearchRouter: CustomerSearchRouter,
    private readonly config: ChannelInboxConfig,
    private readonly messagePresenter: MessagePresenter,
    private readonly channelOutboundMessageRepository: ChannelOutboundMessageRepository,
    private readonly professionalOpportunities?: Pick<ProfessionalOpportunityService, "handle">,
    private readonly contextualConversation?: ContextualInboxHandler,
  ) {}

  async receive(input: ChannelInboundMessageInput): Promise<ChannelInboxOutcome> {
    const registered = await this.repository.createOrFind(input, this.contextualConversation ? { contextual: true } : undefined);
    if (!sameInboundPayload(registered.record, input)) {
      return { kind: "channel_message_payload_conflict" };
    }
    if (registered.record.status === "processed") return this.replay(registered.record);

    const processingToken = randomUUID();
    const claimed = await this.repository.claim(
      registered.record.id,
      processingToken,
      this.config.processingLeaseSeconds,
    );
    if (!claimed) {
      const latest = await this.repository.findById(registered.record.id);
      if (latest?.status === "processed") return this.replay(latest);
      return { kind: "channel_message_processing" };
    }

    try {
      const opportunity = await this.professionalOpportunities?.handle(claimed);
      if (opportunity) return { kind: "response", response: opportunity };
      if (this.contextualConversation) return await this.contextualConversation.handle(claimed);
      const routed = await this.customerSearchRouter.route({
        phone_e164: claimed.phoneE164,
        raw_text: claimed.rawText,
        country_code: claimed.countryCode,
        limit: claimed.limitValue,
        selectionKey: claimed.id,
      });
      if (routed.kind !== "response") {
        await this.repository.markFailed(claimed.id, processingToken, routed.kind);
        return routed;
      }

      const result = customerSearchMessageResponseSchema.parse(routed.response);
      const replyText = presentRouteResult(result, this.messagePresenter);
      const conversationId = routed.conversationId ?? (result.route === "selection" || result.route === "global_command" ? null : result.conversation.conversation_id);
      const searchRequestId = routed.searchRequestId ?? searchRequestIdFrom(result);
      const presentedMatchIds = routed.presentedMatchIds ?? presentedMatchIdsFrom(result);
      const outbound = await this.repository.markProcessedAndCreateOutbound({
        id: claimed.id,
        processingToken,
        result,
        customerId: result.customer_id,
        conversationId,
        searchRequestId,
        outbound: {
          channelInboundMessageId: claimed.id,
          provider: claimed.provider,
          recipientPhoneE164: claimed.phoneE164,
          textContent: replyText,
          searchRequestId,
          matchIds: presentedMatchIds,
        },
      });
      if (!outbound) return { kind: "channel_message_processing" };
      return {
        kind: "response",
        response: {
          message_id: claimed.id,
          duplicate: false,
          reply_text: outbound.textContent,
          outbound: { id: outbound.id, status: outbound.status },
          result: publicResult(result),
        },
      };
    } catch (error) {
      if (error instanceof MatchReservationConflictError) {
        await this.repository.markFailed(claimed.id, processingToken, "show_more_reservation_conflict");
        return { kind: "selection_show_more_pending" };
      }
      await this.repository.markFailed(claimed.id, processingToken, errorCodeFor(error));
      throw error;
    }
  }

  private async replay(record: ChannelInboundMessageRecord): Promise<ChannelInboxOutcome> {
    const contextual = contextualMessageSchema.safeParse(record.result);
    if (contextual.success) {
      const outbound = await this.channelOutboundMessageRepository.findByInboundMessageId(record.id);
      // B2 is atomic: a missing Outbox is corruption, never a reason to regenerate or execute again.
      if (!outbound) return { kind: "channel_message_result_invalid" };
      return { kind: "response", response: { message_id: record.id, duplicate: true, reply_text: outbound.textContent,
        outbound: { id: outbound.id, status: outbound.status }, result: contextual.data } };
    }
    if (opportunityMessageSchema.safeParse(record.result).success) {
      const response = await this.professionalOpportunities?.handle(record);
      return response ? { kind: "response", response } : { kind: "channel_message_result_invalid" };
    }
    const parsed = customerSearchMessageResponseSchema.safeParse(record.result);
    if (!parsed.success) return { kind: "channel_message_result_invalid" };
    const result = parsed.data;
    const replyText = presentRouteResult(result, this.messagePresenter);
    const outbound = await this.channelOutboundMessageRepository.findByInboundMessageId(record.id)
      ?? await this.channelOutboundMessageRepository.createOrFindForProcessedInbound({
        channelInboundMessageId: record.id,
        provider: record.provider,
        recipientPhoneE164: record.phoneE164,
        textContent: replyText,
        searchRequestId: searchRequestIdFrom(result),
        matchIds: presentedMatchIdsFrom(result),
      });
    return {
      kind: "response",
      response: {
        message_id: record.id,
        duplicate: true,
        reply_text: outbound.textContent,
        outbound: { id: outbound.id, status: outbound.status },
        result: publicResult(result),
      },
    };
  }
}
