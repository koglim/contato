import { z } from "zod";
import { phoneE164Schema } from "./phone.js";
import { channelOutboundMessageSummarySchema } from "./channel-outbound.js";
import { customerSearchMessageResponseSchema } from "./customer-search.js";

function hasRawMessageText(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasRawMessageText);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(([key, nested]) => (
    key === "raw_text" || key === "service_text" || hasRawMessageText(nested)
  ));
}

export const channelInboundMessageRequestSchema = z.object({
  provider: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_-]{0,62}$/u),
  provider_message_id: z.string().trim().min(1).max(255),
  phone_e164: phoneE164Schema,
  raw_text: z.string().trim().min(2).max(500),
  country_code: z.string().trim().length(2).transform((value) => value.toUpperCase()).default("BR"),
  limit: z.number().int().min(1).max(10).default(3),
}).strict();

export const channelInboundMessageResponseSchema = z.object({
  message_id: z.string().uuid(),
  duplicate: z.boolean(),
  reply_text: z.string().trim().min(1).max(2_000),
  outbound: channelOutboundMessageSummarySchema,
  result: customerSearchMessageResponseSchema.refine((value) => !hasRawMessageText(value), {
    message: "channel inbox results must not expose raw message text",
  }),
}).strict();
