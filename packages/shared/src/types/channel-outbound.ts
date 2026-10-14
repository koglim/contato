import type { z } from "zod";
import type {
  channelOutboundMessageClaimResponseSchema,
  channelOutboundMessageMutationResponseSchema,
  channelOutboundMessageParamsSchema,
  channelOutboundMessageStatusSchema,
  channelOutboundMessagePurposeSchema,
  markChannelOutboundMessageFailedSchema,
  markChannelOutboundMessageSentSchema,
  channelOutboundQueueStatusSchema,
  channelOutboundReceiptNormalizedStatusSchema,
  recordChannelOutboundReceiptSchema,
  recordChannelOutboundReceiptResponseSchema,
} from "../schemas/channel-outbound.js";

export type ChannelOutboundMessageStatus = z.infer<typeof channelOutboundMessageStatusSchema>;
export type ChannelOutboundMessagePurpose = z.infer<typeof channelOutboundMessagePurposeSchema>;
export type ChannelOutboundMessageParams = z.infer<typeof channelOutboundMessageParamsSchema>;
export type ChannelOutboundMessageClaimResponse = z.infer<typeof channelOutboundMessageClaimResponseSchema>;
export type MarkChannelOutboundMessageSentInput = z.infer<typeof markChannelOutboundMessageSentSchema>;
export type MarkChannelOutboundMessageFailedInput = z.infer<typeof markChannelOutboundMessageFailedSchema>;
export type ChannelOutboundMessageMutationResponse = z.infer<typeof channelOutboundMessageMutationResponseSchema>;
export type ChannelOutboundQueueStatus = z.infer<typeof channelOutboundQueueStatusSchema>;
export type ChannelOutboundReceiptNormalizedStatus = z.infer<typeof channelOutboundReceiptNormalizedStatusSchema>;
export type RecordChannelOutboundReceiptInput = z.infer<typeof recordChannelOutboundReceiptSchema>;
export type RecordChannelOutboundReceiptResponse = z.infer<typeof recordChannelOutboundReceiptResponseSchema>;

