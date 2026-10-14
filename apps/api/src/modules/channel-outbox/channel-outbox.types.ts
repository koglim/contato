import type {
  ChannelOutboundMessageClaimResponse,
  ChannelOutboundMessagePurpose,
  ChannelOutboundMessageStatus,
  MarkChannelOutboundMessageFailedInput,
  MarkChannelOutboundMessageSentInput,
  ChannelOutboundQueueStatus,
  InteractiveOutboundPayload,
  ChannelOutboundReceiptNormalizedStatus,
  RecordChannelOutboundReceiptInput,
  RecordChannelOutboundReceiptResponse,
} from "@contatocerto/shared";


export type ChannelOutboundMessageRecord = {
  id: string;
  channelInboundMessageId: string | null;
  purpose: ChannelOutboundMessagePurpose;
  provider: string;
  recipientPhoneE164: string;
  messageType: "text" | "interactive";
  textContent: string;
  interactivePayload: InteractiveOutboundPayload | null;
  status: ChannelOutboundMessageStatus;
  processingToken: string | null;
  processingStartedAt: Date | null;
  providerMessageId: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
  sentAt: Date | null;
  nextAttemptAt: Date | null;
  administrativeClosedAt: Date | null;
  expiresAt: Date | null;
};

export type CreateChannelOutboundMessage = {
  channelInboundMessageId: string;
  provider: string;
  recipientPhoneE164: string;
  messageType?: "text" | "interactive";
  textContent: string;
  interactivePayload?: InteractiveOutboundPayload | null;
  searchRequestId: string | null;
  matchIds: string[];
};

export type CreateIndependentChannelOutboundMessage = {
  businessKey: string;
  purpose: "professional_contact_notification" | "channel_notice" | "professional_auth_challenge" | "customer_contact_update";
  provider: string;
  recipientPhoneE164: string;
  messageType?: "text" | "interactive";
  textContent: string;
  interactivePayload?: InteractiveOutboundPayload | null;
  expiresAt?: Date | null;
  completionEventId?: string;
  professionalUnavailabilityEventId?: string;
};

export interface ChannelOutboundMessageRepository {
  queueStatus(processingLeaseSeconds: number): Promise<ChannelOutboundQueueStatus>;
  holdDelivery(id: string, input: HoldOutboundInput): Promise<boolean>;
  findById(id: string): Promise<ChannelOutboundMessageRecord | null>;
  findByInboundMessageId(channelInboundMessageId: string): Promise<ChannelOutboundMessageRecord | null>;
  createOrFindForProcessedInbound(input: CreateChannelOutboundMessage): Promise<ChannelOutboundMessageRecord>;
  createIndependent(input: CreateIndependentChannelOutboundMessage): Promise<ChannelOutboundMessageRecord>;
  claim(id: string, processingToken: string, processingLeaseSeconds: number): Promise<ChannelOutboundMessageRecord | null>;
  claimNextPending(processingToken: string, processingLeaseSeconds: number): Promise<ChannelOutboundMessageRecord | null>;
  markSent(id: string, input: MarkChannelOutboundMessageSentInput): Promise<boolean>;
  markFailed(id: string, input: MarkChannelOutboundMessageFailedInput): Promise<boolean>;
  findByProviderMessageId(provider: string, providerMessageId: string): Promise<ChannelOutboundMessageRecord | null>;
  recordReceipt(input: RecordChannelOutboundReceiptInput, fingerprint: string, outboundMessageId: string): Promise<RecordReceiptResult>;
}

export type RecordReceiptResult = {
  receiptId: string;
  outboundMessageId: string;
  normalizedStatus: ChannelOutboundReceiptNormalizedStatus;
  duplicate: boolean;
};

export type ChannelOutboundClaimOutcome =
  | { kind: "response"; response: ChannelOutboundMessageClaimResponse }
  | { kind: "outbound_message_not_found" }
  | { kind: "outbound_queue_empty" }
  | { kind: "outbound_message_expired" }
  | { kind: "outbound_message_processing" };

export type ChannelOutboundMutationOutcome =
  | { kind: "response"; response: { id: string; status: "sent" | "pending" | "failed" } }
  | { kind: "outbound_message_not_found" }
  | { kind: "outbound_message_claim_invalid" };

export interface ChannelOutboundService {
  queueStatus(): Promise<ChannelOutboundQueueStatus>;
  holdDelivery(id: string, input: HoldOutboundInput): Promise<ChannelOutboundHoldOutcome>;
  claim(id: string): Promise<ChannelOutboundClaimOutcome>;
  claimNextPending(): Promise<ChannelOutboundClaimOutcome>;
  markSent(id: string, input: MarkChannelOutboundMessageSentInput): Promise<ChannelOutboundMutationOutcome>;
  markFailed(id: string, input: MarkChannelOutboundMessageFailedInput): Promise<ChannelOutboundMutationOutcome>;
  recordReceipt(input: RecordChannelOutboundReceiptInput): Promise<RecordChannelOutboundReceiptResponse>;
}


export type HoldOutboundInput = {
  processing_token: string;
  reason: "transport_outcome_unknown" | "confirmation_pending";
  provider_message_id?: string;
};

export type ChannelOutboundHoldOutcome =
  | { kind: "response"; response: { id: string; status: "processing"; delivery_status: "reconciliation_required" } }
  | { kind: "outbound_message_not_found" }
  | { kind: "outbound_message_claim_invalid" };
