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

const completedStartResultSchema = messageSearchResponseSchema.refine(
  (result) => !(result.status === "needs_location" && result.stage === "interpretation"),
);

export const startSearchConversationResponseSchema = z.union([
  z.object({
    conversation_id: z.string().uuid(),
    conversation_status: z.literal("active"),
    pending_slot: z.literal("location"),
    result: pendingInterpretationResultSchema,
  }).strict(),
  z.object({
    conversation_id: z.null(),
    conversation_status: z.literal("completed"),
    result: completedStartResultSchema,
  }).strict(),
]);

const completedContinuationResultSchema = z.union([
  searchOrchestrationMatchedResponseSchema,
  searchOrchestrationNoMatchesResponseSchema,
  searchOrchestrationNeedsServiceResponseSchema,
]);

export const continueSearchConversationResponseSchema = z.union([
  z.object({
    conversation_id: z.string().uuid(),
    conversation_status: z.literal("active"),
    pending_slot: z.literal("location"),
    result: searchOrchestrationNeedsLocationResponseSchema,
  }).strict(),
  z.object({
    conversation_id: z.string().uuid(),
    conversation_status: z.literal("completed"),
    pending_slot: z.null(),
    result: completedContinuationResultSchema,
  }).strict(),
]);
