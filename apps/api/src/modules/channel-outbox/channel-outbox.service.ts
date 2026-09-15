import { randomUUID } from "node:crypto";
import type { ChannelOutboundConfig } from "../../config/channel-outbound.js";
import type {
  ChannelOutboundMessageRecord,
  ChannelOutboundMessageRepository,
  ChannelOutboundClaimOutcome,
  ChannelOutboundMutationOutcome,
  ChannelOutboundService,
  ChannelOutboundHoldOutcome,
  HoldOutboundInput,
} from "./channel-outbox.types.js";
import type { MarkChannelOutboundMessageFailedInput, MarkChannelOutboundMessageSentInput } from "@contatocerto/shared";
import { CUSTOMER_REPLY_EXPIRY_REASON } from "./channel-outbox.expiry.js";

function claimResponse(record: ChannelOutboundMessageRecord) {
  if (record.status === "sent") return { id: record.id, status: "sent" as const, attempt_count: record.attemptCount, purpose: record.purpose };
  if (record.status !== "processing" || record.processingToken === null) {
    throw new Error(`Cannot create outbound claim response for ${record.status}`);
  }
  return {
    id: record.id,
    status: "processing" as const,
    attempt_count: record.attemptCount,
    purpose: record.purpose,
    provider: record.provider,
    recipient_phone_e164: record.recipientPhoneE164,
    message_type: record.messageType,
    text_content: record.textContent,
    processing_token: record.processingToken,
  };
}

export class DefaultChannelOutboundService implements ChannelOutboundService {
  constructor(
    private readonly repository: ChannelOutboundMessageRepository,
    private readonly config: ChannelOutboundConfig,
  ) {}

  async queueStatus() {
    return this.repository.queueStatus(this.config.processingLeaseSeconds);
  }

  async claim(id: string): Promise<ChannelOutboundClaimOutcome> {
    const claimed = await this.repository.claim(id, randomUUID(), this.config.processingLeaseSeconds);
    if (claimed) return { kind: "response", response: claimResponse(claimed) };

    const current = await this.repository.findById(id);
    if (!current) return { kind: "outbound_message_not_found" };
    if (current.status === "sent") return { kind: "response", response: claimResponse(current) };
    if (current.purpose === "customer_reply"
      && current.status === "failed"
      && current.administrativeClosedAt !== null
      && current.lastErrorCode === CUSTOMER_REPLY_EXPIRY_REASON) {
      return { kind: "outbound_message_expired" };
    }
    return { kind: "outbound_message_processing" };
  }

  async claimNextPending(): Promise<ChannelOutboundClaimOutcome> {
    const claimed = await this.repository.claimNextPending(randomUUID(), this.config.processingLeaseSeconds);
    if (claimed) return { kind: "response", response: claimResponse(claimed) };
    return { kind: "outbound_queue_empty" };
  }

  async markSent(id: string, input: MarkChannelOutboundMessageSentInput): Promise<ChannelOutboundMutationOutcome> {
    if (await this.repository.markSent(id, input)) return { kind: "response", response: { id, status: "sent" } };
    return this.mutationFailure(id);
  }

  async markFailed(id: string, input: MarkChannelOutboundMessageFailedInput): Promise<ChannelOutboundMutationOutcome> {
    if (await this.repository.markFailed(id, input)) {
      const current = await this.repository.findById(id);
      return { kind: "response", response: { id, status: current?.status === "pending" ? "pending" : "failed" } };
    }
    return this.mutationFailure(id);
  }

  async holdDelivery(id: string, input: HoldOutboundInput): Promise<ChannelOutboundHoldOutcome> {
    if (await this.repository.holdDelivery(id, input)) {
      return { kind: "response", response: { id, status: "processing", delivery_status: "reconciliation_required" } };
    }
    return this.mutationFailure(id);
  }

  private async mutationFailure(id: string): Promise<Exclude<ChannelOutboundMutationOutcome, { kind: "response" }>> {
    return (await this.repository.findById(id))
      ? { kind: "outbound_message_claim_invalid" }
      : { kind: "outbound_message_not_found" };
  }
}
