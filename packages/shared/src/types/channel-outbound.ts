import type { z } from "zod";
import type {
  channelOutboundMessageClaimResponseSchema,
  channelOutboundMessageMutationResponseSchema,
  channelOutboundMessageParamsSchema,
  channelOutboundMessageStatusSchema,
  markChannelOutboundMessageFailedSchema,
  markChannelOutboundMessageSentSchema,
} from "../schemas/channel-outbound.js";

export type ChannelOutboundMessageStatus = z.infer<typeof channelOutboundMessageStatusSchema>;
export type ChannelOutboundMessageParams = z.infer<typeof channelOutboundMessageParamsSchema>;
export type ChannelOutboundMessageClaimResponse = z.infer<typeof channelOutboundMessageClaimResponseSchema>;
export type MarkChannelOutboundMessageSentInput = z.infer<typeof markChannelOutboundMessageSentSchema>;
export type MarkChannelOutboundMessageFailedInput = z.infer<typeof markChannelOutboundMessageFailedSchema>;
export type ChannelOutboundMessageMutationResponse = z.infer<typeof channelOutboundMessageMutationResponseSchema>;
