import type {
  ChannelOutboundMessageClaimResponse,
  ChannelOutboundMessagePurpose,
  ChannelOutboundMessageStatus,
  MarkChannelOutboundMessageFailedInput,
  MarkChannelOutboundMessageSentInput,
} from "@contatocerto/shared";

export type ChannelOutboundMessageRecord = {
  id: string;
  channelInboundMessageId: string | null;
  purpose: ChannelOutboundMessagePurpose;
  provider: string;
  recipientPhoneE164: string;
  messageType: "text";
  textContent: string;
  status: ChannelOutboundMessageStatus;
  processingToken: string | null;
  processingStartedAt: Date | null;
  providerMessageId: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
  sentAt: Date | null;
};

export type CreateChannelOutboundMessage = {
  channelInboundMessageId: string;
  provider: string;
  recipientPhoneE164: string;
  textContent: string;
  searchRequestId: string | null;
  matchIds: string[];
};

export type CreateIndependentChannelOutboundMessage = {
  businessKey: string;
  purpose: "professional_contact_notification";
  provider: string;
  recipientPhoneE164: string;
  textContent: string;
};

export interface ChannelOutboundMessageRepository {
  findById(id: string): Promise<ChannelOutboundMessageRecord | null>;
  findByInboundMessageId(channelInboundMessageId: string): Promise<ChannelOutboundMessageRecord | null>;
  createOrFindForProcessedInbound(input: CreateChannelOutboundMessage): Promise<ChannelOutboundMessageRecord>;
  createIndependent(input: CreateIndependentChannelOutboundMessage): Promise<ChannelOutboundMessageRecord>;
  claim(id: string, processingToken: string, processingLeaseSeconds: number): Promise<ChannelOutboundMessageRecord | null>;
  claimNextPending(processingToken: string, processingLeaseSeconds: number): Promise<ChannelOutboundMessageRecord | null>;
  markSent(id: string, input: MarkChannelOutboundMessageSentInput): Promise<boolean>;
  markFailed(id: string, input: MarkChannelOutboundMessageFailedInput): Promise<boolean>;
}

export type ChannelOutboundClaimOutcome =
  | { kind: "response"; response: ChannelOutboundMessageClaimResponse }
  | { kind: "outbound_message_not_found" }
  | { kind: "outbound_queue_empty" }
  | { kind: "outbound_message_processing" };

export type ChannelOutboundMutationOutcome =
  | { kind: "response"; response: { id: string; status: "sent" | "failed" } }
  | { kind: "outbound_message_not_found" }
  | { kind: "outbound_message_claim_invalid" };

export interface ChannelOutboundService {
  claim(id: string): Promise<ChannelOutboundClaimOutcome>;
  claimNextPending(): Promise<ChannelOutboundClaimOutcome>;
  markSent(id: string, input: MarkChannelOutboundMessageSentInput): Promise<ChannelOutboundMutationOutcome>;
  markFailed(id: string, input: MarkChannelOutboundMessageFailedInput): Promise<ChannelOutboundMutationOutcome>;
}
