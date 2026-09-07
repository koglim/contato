import { randomUUID } from "node:crypto";
import { customerSearchMessageResponseSchema, type ChannelInboundMessageInput } from "@contatocerto/shared";
import { GeocodingProviderError } from "../location-resolution/location-resolution.types.js";
import type { CustomerSearchRouter } from "../customer-search/customer-search.types.js";
import type { ChannelInboxConfig } from "../../config/channel-inbox.js";
import type { MessagePresenter } from "../message-presentation/message-presentation.types.js";
import type { ChannelOutboundMessageRepository } from "../channel-outbox/channel-outbox.types.js";
import type {
  ChannelInboxOutcome,
  ChannelInboxService,
  ChannelInboundMessageRecord,
  ChannelInboundMessageRepository,
} from "./channel-inbox.types.js";

function searchRequestIdFrom(record: ReturnType<typeof customerSearchMessageResponseSchema.parse>): string | null {
  const result = record.conversation.result;
  if ("matching" in result) return result.matching?.search_request_id ?? null;
  return result.orchestration?.matching?.search_request_id ?? null;
}

function presentedMatchIdsFrom(record: ReturnType<typeof customerSearchMessageResponseSchema.parse>): string[] {
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
  ) {}

  async receive(input: ChannelInboundMessageInput): Promise<ChannelInboxOutcome> {
    const registered = await this.repository.createOrFind(input);
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
      const routed = await this.customerSearchRouter.route({
        phone_e164: claimed.phoneE164,
        raw_text: claimed.rawText,
        country_code: claimed.countryCode,
        limit: claimed.limitValue,
      });
      if (routed.kind !== "response") {
        await this.repository.markFailed(claimed.id, processingToken, routed.kind);
        return routed;
      }

      const result = customerSearchMessageResponseSchema.parse(routed.response);
      const replyText = this.messagePresenter.present(result);
      const outbound = await this.repository.markProcessedAndCreateOutbound({
        id: claimed.id,
        processingToken,
        result,
        customerId: result.customer_id,
        conversationId: result.conversation.conversation_id,
        searchRequestId: searchRequestIdFrom(result),
        outbound: {
          channelInboundMessageId: claimed.id,
          provider: claimed.provider,
          recipientPhoneE164: claimed.phoneE164,
          textContent: replyText,
          searchRequestId: searchRequestIdFrom(result),
          matchIds: presentedMatchIdsFrom(result),
        },
      });
      if (!outbound) return { kind: "channel_message_processing" };
      return {
        kind: "response",
        response: {
          message_id: claimed.id,
          duplicate: false,
          reply_text: replyText,
          outbound: { id: outbound.id, status: outbound.status },
          result: publicResult(result),
        },
      };
    } catch (error) {
      await this.repository.markFailed(claimed.id, processingToken, errorCodeFor(error));
      throw error;
    }
  }

  private async replay(record: ChannelInboundMessageRecord): Promise<ChannelInboxOutcome> {
    const parsed = customerSearchMessageResponseSchema.safeParse(record.result);
    if (!parsed.success) return { kind: "channel_message_result_invalid" };
    const replyText = this.messagePresenter.present(parsed.data);
    const outbound = await this.channelOutboundMessageRepository.findByInboundMessageId(record.id)
      ?? await this.channelOutboundMessageRepository.createOrFindForProcessedInbound({
        channelInboundMessageId: record.id,
        provider: record.provider,
        recipientPhoneE164: record.phoneE164,
        textContent: replyText,
        searchRequestId: searchRequestIdFrom(parsed.data),
        matchIds: presentedMatchIdsFrom(parsed.data),
      });
    return {
      kind: "response",
      response: {
        message_id: record.id,
        duplicate: true,
        reply_text: replyText,
        outbound: { id: outbound.id, status: outbound.status },
        result: publicResult(parsed.data),
      },
    };
  }
}
