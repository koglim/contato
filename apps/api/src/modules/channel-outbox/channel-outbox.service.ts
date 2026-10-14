import { createHash, randomUUID } from "node:crypto";
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
import type {
  MarkChannelOutboundMessageFailedInput,
  MarkChannelOutboundMessageSentInput,
  RecordChannelOutboundReceiptInput,
  RecordChannelOutboundReceiptResponse,
} from "@contatocerto/shared";

import { CUSTOMER_REPLY_EXPIRY_REASON } from "./channel-outbox.expiry.js";
import { decryptAuthEnvelope, validateProfessionalAuthPepper } from "../professional-auth/professional-auth.crypto.js";

function claimResponse(record: ChannelOutboundMessageRecord, config?: ChannelOutboundConfig) {
  if (record.status === "sent") return { id: record.id, status: "sent" as const, attempt_count: record.attemptCount, purpose: record.purpose };
  if (record.status !== "processing" || record.processingToken === null) {
    throw new Error(`Cannot create outbound claim response for ${record.status}`);
  }

  if (record.purpose === "professional_auth_challenge") {
    const pepper = process.env.PROFESSIONAL_AUTH_PEPPER;
    validateProfessionalAuthPepper(pepper);

    const templateName = config?.authTemplateName ?? process.env.WHATSAPP_PROFESSIONAL_AUTH_TEMPLATE_NAME?.trim();
    const templateLanguage = config?.authTemplateLanguage ?? process.env.WHATSAPP_PROFESSIONAL_AUTH_TEMPLATE_LANGUAGE?.trim();

    if (!templateName || !/^[a-z0-9_]+$/.test(templateName)) {
      throw new Error("WHATSAPP_PROFESSIONAL_AUTH_TEMPLATE_NAME is required and must be a lower-case Meta-safe identifier");
    }
    if (!templateLanguage || !/^[a-z]{2}(_[A-Z]{2})?$/.test(templateLanguage)) {
      throw new Error("WHATSAPP_PROFESSIONAL_AUTH_TEMPLATE_LANGUAGE is required and must be standard format like pt_BR or en_US");
    }

    const { otp } = decryptAuthEnvelope(pepper, record.textContent);

    return {
      id: record.id,
      status: "processing" as const,
      attempt_count: record.attemptCount,
      purpose: record.purpose,
      provider: record.provider,
      recipient_phone_e164: record.recipientPhoneE164,
      message_type: "interactive" as const,
      text_content: `[auth template: ${templateName}]`,
      interactive_payload: {
        schema_version: 1 as const,
        type: "template_authentication" as const,
        template_name: templateName,
        language_code: templateLanguage,
        otp_code: otp,
      },
      processing_token: record.processingToken,
    };
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
    ...(record.interactivePayload ? { interactive_payload: record.interactivePayload } : {}),
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
    if (claimed) return { kind: "response", response: claimResponse(claimed, this.config) };

    const current = await this.repository.findById(id);
    if (!current) return { kind: "outbound_message_not_found" };
    if (current.status === "sent") return { kind: "response", response: claimResponse(current, this.config) };
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
    if (claimed) return { kind: "response", response: claimResponse(claimed, this.config) };
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

  async recordReceipt(input: RecordChannelOutboundReceiptInput): Promise<RecordChannelOutboundReceiptResponse> {
    const outbound = await this.repository.findByProviderMessageId(input.provider, input.provider_message_id);
    if (!outbound) {
      return {
        outcome: "unknown_provider_message_id",
        provider: input.provider,
        provider_message_id: input.provider_message_id,
      };
    }
    const fingerprint = computeReceiptFingerprint(input);
    const result = await this.repository.recordReceipt(input, fingerprint, outbound.id);
    return {
      outcome: "recorded",
      receipt_id: result.receiptId,
      outbound_message_id: result.outboundMessageId,
      normalized_status: result.normalizedStatus,
      duplicate: result.duplicate,
    };
  }

  private async mutationFailure(id: string): Promise<Exclude<ChannelOutboundMutationOutcome, { kind: "response" }>> {
    return (await this.repository.findById(id))
      ? { kind: "outbound_message_claim_invalid" }
      : { kind: "outbound_message_not_found" };
  }
}

export function computeReceiptFingerprint(input: RecordChannelOutboundReceiptInput): string {
  const canonical = JSON.stringify([
    input.provider,
    input.provider_message_id,
    input.provider_status,
    input.normalized_status,
    input.provider_event_at ?? null,
    input.provider_error_code ?? null,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

