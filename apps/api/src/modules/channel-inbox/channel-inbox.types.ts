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
  recoveryState?: "active" | "quarantined" | "closed";
  contextualQueue?: boolean;
  attemptCount?: number;
  contextFingerprint?: string | null;
};

export type MarkProcessedInboundMessage = {
  id: string;
  processingToken: string;
  result: CustomerSearchMessageResponse | Extract<ChannelInboundMessageResponse["result"], { route: "contextual" }>;
  customerId: string;
  conversationId: string | null;
  searchRequestId: string | null;
};

export type MarkProcessedInboundMessageWithOutbound = MarkProcessedInboundMessage & {
  outbound: CreateChannelOutboundMessage;
};

export interface ChannelInboundMessageRepository {
  createOrFind(input: ChannelInboundMessageInput, options?: { contextual: boolean }): Promise<{ record: ChannelInboundMessageRecord; created: boolean }>;
  findById(id: string): Promise<ChannelInboundMessageRecord | null>;
  claim(id: string, processingToken: string, processingLeaseSeconds: number): Promise<ChannelInboundMessageRecord | null>;
  markProcessedAndCreateOutbound(input: MarkProcessedInboundMessageWithOutbound): Promise<ChannelOutboundMessageRecord | null>;
  markFailed(id: string, processingToken: string, errorCode: string): Promise<boolean>;
  recordPayloadConflict?(id: string, input: ChannelInboundMessageInput): Promise<void>;
  quarantineResult?(id: string): Promise<void>;
  recordFence?(id: string, token: string): Promise<void>;
  deferContention?(id: string, token: string): Promise<void>;
  runAtomic?<T>(record: ChannelInboundMessageRecord, operation: () => Promise<T>, acknowledgeContextChange?: boolean): Promise<T>;
}

export type ChannelInboxOutcome =
  | { kind: "response"; response: ChannelInboundMessageResponse }
  | { kind: "channel_message_processing" }
  | { kind: "channel_message_payload_conflict" }
  | { kind: "channel_message_result_invalid" }
  | { kind: "customer_conversation_conflict" }
  | { kind: "conversation_processing" }
  | { kind: "service_unavailable" }
  | { kind: "selection_idempotency_key_required" }
  | { kind: "selection_show_more_pending" };

export interface ChannelInboxService {
  receive(input: ChannelInboundMessageInput): Promise<ChannelInboxOutcome>;
  processClaimed?(record: ChannelInboundMessageRecord): Promise<ChannelInboxOutcome>;
}
