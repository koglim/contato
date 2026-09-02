import type {
  ChannelInboundMessageInput,
  ChannelInboundMessageResponse,
  CustomerSearchMessageResponse,
} from "@contatocerto/shared";
import type { ChannelOutboundMessageRecord, CreateChannelOutboundMessage } from "../channel-outbox/channel-outbox.types.js";

export type ChannelInboundMessageStatus = "received" | "processing" | "processed" | "failed";

export type ChannelInboundMessageRecord = {
  id: string;
  provider: string;
  providerMessageId: string;
  phoneE164: string;
  rawText: string;
  countryCode: string;
  limitValue: number;
  status: ChannelInboundMessageStatus;
  customerId: string | null;
  conversationId: string | null;
  searchRequestId: string | null;
  result: unknown;
  errorCode: string | null;
  processingToken: string | null;
  processingStartedAt: Date | null;
};

export type MarkProcessedInboundMessage = {
  id: string;
  processingToken: string;
  result: CustomerSearchMessageResponse;
  customerId: string;
  conversationId: string | null;
  searchRequestId: string | null;
};

export type MarkProcessedInboundMessageWithOutbound = MarkProcessedInboundMessage & {
  outbound: CreateChannelOutboundMessage;
};

export interface ChannelInboundMessageRepository {
  createOrFind(input: ChannelInboundMessageInput): Promise<{ record: ChannelInboundMessageRecord; created: boolean }>;
  findById(id: string): Promise<ChannelInboundMessageRecord | null>;
  claim(id: string, processingToken: string, processingLeaseSeconds: number): Promise<ChannelInboundMessageRecord | null>;
  markProcessedAndCreateOutbound(input: MarkProcessedInboundMessageWithOutbound): Promise<ChannelOutboundMessageRecord | null>;
  markFailed(id: string, processingToken: string, errorCode: string): Promise<boolean>;
}

export type ChannelInboxOutcome =
  | { kind: "response"; response: ChannelInboundMessageResponse }
  | { kind: "channel_message_processing" }
  | { kind: "channel_message_payload_conflict" }
  | { kind: "channel_message_result_invalid" }
  | { kind: "channel_message_outbound_missing" }
  | { kind: "customer_conversation_conflict" }
  | { kind: "conversation_processing" }
  | { kind: "service_unavailable" };

export interface ChannelInboxService {
  receive(input: ChannelInboundMessageInput): Promise<ChannelInboxOutcome>;
}
