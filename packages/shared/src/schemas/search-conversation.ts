import { z } from "zod";
import { messageSearchRequestSchema, messageSearchResponseSchema } from "./message-search.js";
import {
  searchOrchestrationMatchedResponseSchema,
  searchOrchestrationNeedsLocationResponseSchema,
  searchOrchestrationNeedsServiceResponseSchema,
  searchOrchestrationNoMatchesResponseSchema,
} from "./search-orchestration.js";

export const startSearchConversationRequestSchema = messageSearchRequestSchema;

export const continueSearchConversationParamsSchema = z.object({
  conversationId: z.string().uuid(),
}).strict();

export const continueSearchConversationRequestSchema = z.object({
  raw_text: z.string().trim().min(2).max(500),
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
    return !waitsForLocation && !waitsForService;
  },
);

const activeStartSearchConversationResponseSchema = z.discriminatedUnion("pending_slot", [
  z.object({
    conversation_id: z.string().uuid(),
    conversation_status: z.literal("active"),
    pending_slot: z.literal("service"),
    result: pendingServiceResultSchema,
  }).strict(),
  z.object({
    conversation_id: z.string().uuid(),
    conversation_status: z.literal("active"),
    pending_slot: z.literal("location"),
    result: pendingInterpretationResultSchema,
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

const completedContinuationResultSchema = z.union([
  searchOrchestrationMatchedResponseSchema,
  searchOrchestrationNoMatchesResponseSchema,
]);

const activeContinueSearchConversationResponseSchema = z.discriminatedUnion("pending_slot", [
  z.object({
    conversation_id: z.string().uuid(),
    conversation_status: z.literal("active"),
    pending_slot: z.literal("service"),
    result: searchOrchestrationNeedsServiceResponseSchema,
  }).strict(),
  z.object({
    conversation_id: z.string().uuid(),
    conversation_status: z.literal("active"),
    pending_slot: z.literal("location"),
    result: searchOrchestrationNeedsLocationResponseSchema,
  }).strict(),
]);

export const continueSearchConversationResponseSchema = z.union([
  activeContinueSearchConversationResponseSchema,
  z.object({
    conversation_id: z.string().uuid(),
    conversation_status: z.literal("completed"),
    pending_slot: z.null(),
    result: completedContinuationResultSchema,
  }).strict(),
]);
