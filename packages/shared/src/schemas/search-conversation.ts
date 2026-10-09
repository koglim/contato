import { z } from "zod";
import { messageSearchRequestSchema, messageSearchResponseSchema } from "./message-search.js";
import {
  searchOrchestrationMatchedResponseSchema,
  searchOrchestrationNeedsLocationResponseSchema,
  searchOrchestrationNeedsServiceResponseSchema,
  searchOrchestrationNoMatchesResponseSchema,
} from "./search-orchestration.js";

import { channelLocationInputSchema } from "./channel-location.js";

export const startSearchConversationRequestSchema = messageSearchRequestSchema;

export const continueSearchConversationParamsSchema = z.object({
  conversationId: z.string().uuid(),
}).strict();

export const continueSearchConversationRequestSchema = z.object({
  raw_text: z.string().trim().min(1).max(500).optional(),
  location: channelLocationInputSchema.optional(),
}).strict().refine((data) => data.raw_text !== undefined || data.location !== undefined, {
  message: "Either raw_text or location must be provided",
});

export const locationConfirmationResultSchema = z.object({
  status: z.literal("needs_location_confirmation"),
  service_name: z.string().optional(),
  location_text: z.string(),
  prompt: z.string(),
}).strict();

export const nativeLocationNeedsServiceResultSchema = z.object({
  status: z.literal("needs_service"),
  location_text: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  prompt: z.string().optional(),
}).strict();

const pendingInterpretationResultSchema = messageSearchResponseSchema.refine(
  (result) => result.status === "needs_location" && result.stage === "interpretation",
);

const pendingServiceResultSchema = messageSearchResponseSchema.refine(
  (result) => result.status === "needs_service"
    && result.stage === "service_resolution"
    && result.interpretation.location_text.trim().length > 0,
);

const completedStartResultSchema = messageSearchResponseSchema.refine(
  (result) => {
    const waitsForLocation = result.status === "needs_location" && result.stage === "interpretation";
    const waitsForService = result.status === "needs_service"
      && result.stage === "service_resolution"
      && result.interpretation.location_text.trim().length > 0;
    return !waitsForLocation && !waitsForService && result.status !== "matched";
  },
);

const pendingSelectionStartResultSchema = messageSearchResponseSchema.refine(
  (result) => result.status === "matched",
);

const activeStartSearchConversationResponseSchema = z.discriminatedUnion("pending_slot", [
  z.object({
    conversation_id: z.string().uuid(),
    conversation_status: z.literal("active"),
    pending_slot: z.literal("service"),
    result: z.union([pendingServiceResultSchema, nativeLocationNeedsServiceResultSchema]),
  }).strict(),
  z.object({
    conversation_id: z.string().uuid(),
    conversation_status: z.literal("active"),
    pending_slot: z.literal("selection"),
    result: pendingSelectionStartResultSchema,
  }).strict(),
  z.object({
    conversation_id: z.string().uuid(),
    conversation_status: z.literal("active"),
    pending_slot: z.literal("location"),
    result: pendingInterpretationResultSchema,
  }).strict(),
  z.object({
    conversation_id: z.string().uuid(),
    conversation_status: z.literal("active"),
    pending_slot: z.literal("location_confirmation"),
    result: locationConfirmationResultSchema,
  }).strict(),
]);

export const startSearchConversationResponseSchema = z.union([
  activeStartSearchConversationResponseSchema,
  z.object({
    conversation_id: z.null(),
    conversation_status: z.literal("completed"),
    result: completedStartResultSchema,
  }).strict(),
]);

const activeContinueSearchConversationResponseSchema = z.discriminatedUnion("pending_slot", [
  z.object({
    conversation_id: z.string().uuid(),
    conversation_status: z.literal("active"),
    pending_slot: z.literal("service"),
    result: z.union([
      searchOrchestrationNeedsServiceResponseSchema,
      messageSearchResponseSchema.refine((value) => value.status === "needs_service"),
    ]),
  }).strict(),
  z.object({
    conversation_id: z.string().uuid(),
    conversation_status: z.literal("active"),
    pending_slot: z.literal("selection"),
    result: z.union([
      searchOrchestrationMatchedResponseSchema,
      messageSearchResponseSchema.refine((value) => value.status === "matched"),
    ]),
  }).strict(),
  z.object({
    conversation_id: z.string().uuid(),
    conversation_status: z.literal("active"),
    pending_slot: z.literal("location"),
    result: z.union([
      searchOrchestrationNeedsLocationResponseSchema,
      messageSearchResponseSchema.refine((value) => value.status === "needs_location"),
    ]),
  }).strict(),
  z.object({
    conversation_id: z.string().uuid(),
    conversation_status: z.literal("active"),
    pending_slot: z.literal("location_confirmation"),
    result: locationConfirmationResultSchema,
  }).strict(),
]);

export const continueSearchConversationResponseSchema = z.union([
  activeContinueSearchConversationResponseSchema,
  z.object({
    conversation_id: z.string().uuid(),
    conversation_status: z.literal("completed"),
    pending_slot: z.null(),
    result: z.union([
      searchOrchestrationNoMatchesResponseSchema,
      messageSearchResponseSchema.refine((value) => value.status === "no_matches"),
    ]),
  }).strict(),
]);
