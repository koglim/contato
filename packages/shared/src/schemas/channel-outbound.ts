import { z } from "zod";
import { phoneE164Schema } from "./phone.js";

export const channelOutboundMessageStatusSchema = z.enum(["pending", "processing", "sent", "failed"]);

export const channelOutboundMessageSummarySchema = z.object({
  id: z.string().uuid(),
  status: channelOutboundMessageStatusSchema,
}).strict();

export const channelOutboundMessageParamsSchema = z.object({
  outboundId: z.string().uuid(),
}).strict();

const outboundClaimBaseSchema = z.object({
  id: z.string().uuid(),
  status: channelOutboundMessageStatusSchema,
  attempt_count: z.number().int().nonnegative(),
}).strict();

export const channelOutboundMessageClaimResponseSchema = z.discriminatedUnion("status", [
  outboundClaimBaseSchema.extend({
    status: z.literal("processing"),
    provider: z.string().min(1).max(63),
    recipient_phone_e164: phoneE164Schema,
    message_type: z.literal("text"),
    text_content: z.string().trim().min(1).max(2_000),
    processing_token: z.string().uuid(),
  }).strict(),
  outboundClaimBaseSchema.extend({ status: z.literal("sent") }).strict(),
]);

export const markChannelOutboundMessageSentSchema = z.object({
  processing_token: z.string().uuid(),
  provider_message_id: z.string().trim().min(1).max(255),
}).strict();

export const markChannelOutboundMessageFailedSchema = z.object({
  processing_token: z.string().uuid(),
  error_code: z.string().trim().regex(/^[a-z][a-z0-9_]{0,119}$/u),
}).strict();

export const channelOutboundMessageMutationResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["sent", "failed"]),
}).strict();
