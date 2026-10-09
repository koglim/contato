import type { z } from "zod";
import type {
  channelInboundMessageRequestSchema,
  channelInboundMessageResponseSchema,
} from "../schemas/channel-inbox.js";
import type { ChannelLocationInput } from "../schemas/channel-location.js";

export type ChannelInboundMessageInput = z.infer<typeof channelInboundMessageRequestSchema>;
export type ChannelInboundMessageResponse = z.infer<typeof channelInboundMessageResponseSchema>;
export type { ChannelLocationInput };
