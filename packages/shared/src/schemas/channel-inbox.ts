import { z } from "zod";
import { phoneE164Schema } from "./phone.js";
import { channelOutboundMessageSummarySchema } from "./channel-outbound.js";
import { customerSearchMessageResponseSchema } from "./customer-search.js";
import { opportunityMessageSchema } from "./opportunity-message.js";
import { contextualMessageSchema } from "./contextual-message.js";

function hasRawMessageText(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasRawMessageText);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(([key, nested]) => (
    key === "raw_text" || key === "service_text" || hasRawMessageText(nested)
  ));
}

// The Inbox intentionally omits these two private interpretation fields. Validate
// the remaining complete domain contract with placeholders that never leave this
// function; do not accept arbitrary objects merely because they contain a route.
const publicCustomerResultSchema = z.custom<z.infer<typeof customerSearchMessageResponseSchema>>((value) => {
  if (hasRawMessageText(value)) return false;
  if (typeof value !== "object" || value === null) return false;
  const candidate = structuredClone(value) as { conversation?: { result?: { interpretation?: Record<string, unknown> } } };
  const interpretation = candidate.conversation?.result?.interpretation;
  if (interpretation && typeof interpretation === "object") {
    interpretation.raw_text = "[omitted]";
    interpretation.service_text = "[omitted]";
  }
  return customerSearchMessageResponseSchema.safeParse(candidate).success;
});

export const channelInboundMessageRequestSchema = z.object({
  provider: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_-]{0,62}$/u),
  provider_message_id: z.string().trim().min(1).max(255),
  phone_e164: phoneE164Schema,
  raw_text: z.string().trim().min(1).max(500),
  country_code: z.string().trim().length(2).transform((value) => value.toUpperCase()).default("BR"),
  limit: z.number().int().min(1).max(10).default(3),
}).strict();

export const channelInboundMessageResponseSchema = z.object({
  message_id: z.string().uuid(),
  duplicate: z.boolean(),
  reply_text: z.string().trim().min(1).max(2_000),
  outbound: channelOutboundMessageSummarySchema,
  result: z.union([publicCustomerResultSchema, opportunityMessageSchema, contextualMessageSchema]).refine((value) => !hasRawMessageText(value), {
    message: "channel inbox results must not expose raw message text",
  }),
}).strict();
