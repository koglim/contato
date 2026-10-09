import { z } from "zod";
import {
  continueSearchConversationResponseSchema,
  startSearchConversationResponseSchema,
} from "./search-conversation.js";
import { phoneE164Schema, normalizeBrazilianMobilePhone } from "./phone.js";
import { selectionMessageContractSchema } from "./selection-message.js";
import { globalConversationMessageContractSchema } from "./global-conversation-message.js";

import { channelLocationInputSchema } from "./channel-location.js";

export const customerSearchMessageRequestSchema = z.object({
  phone_e164: phoneE164Schema.transform(normalizeBrazilianMobilePhone),
  raw_text: z.string().trim().min(1).max(500).optional(),
  location: channelLocationInputSchema.optional(),
  country_code: z.string().trim().length(2).transform((value) => value.toUpperCase()).default("BR"),
  limit: z.number().int().min(1).max(10).default(3),
}).strict().refine((data) => data.raw_text !== undefined || data.location !== undefined, {
  message: "Either raw_text or location must be provided",
});

export const customerSearchMessageResponseSchema = z.discriminatedUnion("route", [
  z.object({
    customer_id: z.string().uuid(),
    route: z.literal("started"),
    conversation: startSearchConversationResponseSchema,
  }).strict(),
  z.object({
    customer_id: z.string().uuid(),
    route: z.literal("continued"),
    conversation: continueSearchConversationResponseSchema,
  }).strict(),
  z.object({
    customer_id: z.string().uuid(),
    route: z.literal("selection"),
    result: selectionMessageContractSchema,
  }).strict(),
  z.object({
    customer_id: z.string().uuid(),
    route: z.literal("global_command"),
    result: globalConversationMessageContractSchema,
  }).strict(),
]);
