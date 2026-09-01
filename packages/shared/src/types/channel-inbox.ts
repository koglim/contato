import type { z } from "zod";
import type {
  channelInboundMessageRequestSchema,
  channelInboundMessageResponseSchema,
} from "../schemas/channel-inbox.js";

export type ChannelInboundMessageInput = z.infer<typeof channelInboundMessageRequestSchema>;
export type ChannelInboundMessageResponse = z.infer<typeof channelInboundMessageResponseSchema>;
