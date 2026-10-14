import { z } from "zod";
import { phoneE164Schema } from "./phone.js";
import { interactiveOutboundPayloadSchema } from "./interactive-action.js";

export const channelOutboundMessageStatusSchema = z.enum(["pending", "processing", "sent", "failed"]);
export const channelOutboundMessagePurposeSchema = z.enum(["customer_reply", "professional_contact_notification", "professional_reply", "customer_contact_update", "channel_notice", "professional_auth_challenge"]);

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
  purpose: channelOutboundMessagePurposeSchema,
}).strict();

export const channelOutboundMessageClaimResponseSchema = z.discriminatedUnion("status", [
  outboundClaimBaseSchema.extend({
    status: z.literal("processing"),
    provider: z.string().min(1).max(63),
    recipient_phone_e164: phoneE164Schema,
    message_type: z.enum(["text", "interactive"]),
    text_content: z.string().trim().min(1).max(2_000),
    interactive_payload: interactiveOutboundPayloadSchema.nullable().optional(),
    processing_token: z.string().uuid(),
  }).strict().refine((data) => {
    if (data.message_type === "text") return !data.interactive_payload;
    if (data.message_type === "interactive") return Boolean(data.interactive_payload);
    return false;
  }, {
    message: "interactive_payload must be provided if and only if message_type is interactive",
  }),
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

export const holdChannelOutboundMessageSchema = z.object({
  processing_token: z.string().uuid(),
  reason: z.enum(["transport_outcome_unknown", "confirmation_pending"]),
  provider_message_id: z.string().trim().min(1).max(255).optional(),
}).strict();

export const channelOutboundHoldResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("processing"),
  delivery_status: z.literal("reconciliation_required"),
}).strict();

export const channelOutboundMessageMutationResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["sent", "pending", "failed"]),
}).strict();

const queueCount = z.number().int().nonnegative();
export const channelOutboundQueueStatusSchema = z.object({
  items: z.array(z.object({
    purpose: channelOutboundMessagePurposeSchema,
    pending: queueCount,
    scheduled_retry: queueCount,
    processing: queueCount,
    expired_lease: queueCount,
    reconciliation_required: queueCount,
    failed: queueCount,
    dead_letter: queueCount,
    oldest_unfinished_at: z.string().datetime({ offset: true }),
  }).strict()).max(6),
}).strict();

export const channelOutboundReceiptNormalizedStatusSchema = z.enum([
  "accepted",
  "delivered",
  "read",
  "failed",
  "unknown",
]);

function hasNoAsciiControl(val: string): boolean {
  for (let i = 0; i < val.length; i++) {
    const code = val.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127) {
      return false;
    }
  }
  return true;
}

export const recordChannelOutboundReceiptSchema = z.object({
  provider: z.string().trim().regex(/^[a-z][a-z0-9_-]{0,62}$/u),
  provider_message_id: z.string().trim().min(1).max(255).refine(hasNoAsciiControl, {
    message: "provider_message_id must not contain ASCII control characters",
  }),
  provider_status: z.string().trim().min(1).max(64).refine(hasNoAsciiControl, {
    message: "provider_status must not contain ASCII control characters",
  }),
  normalized_status: channelOutboundReceiptNormalizedStatusSchema,
  provider_event_at: z.string().datetime({ offset: true }).optional().nullable(),
  provider_error_code: z.string().trim().min(1).max(64).optional().nullable(),
  provider_error_reason: z.string().trim().min(1).max(500).optional().nullable(),
}).strict();

export const recordChannelOutboundReceiptResponseSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("recorded"),
    receipt_id: z.string().uuid(),
    outbound_message_id: z.string().uuid(),
    normalized_status: channelOutboundReceiptNormalizedStatusSchema,
    duplicate: z.boolean(),
  }).strict(),
  z.object({
    outcome: z.literal("unknown_provider_message_id"),
    provider: z.string().trim().regex(/^[a-z][a-z0-9_-]{0,62}$/u),
    provider_message_id: z.string().trim().min(1).max(255).refine(hasNoAsciiControl),
  }).strict(),
]);

