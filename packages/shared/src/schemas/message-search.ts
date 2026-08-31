import { z } from "zod";
import {
  messageInterpretationRequestSchema,
  messageInterpretedResponseSchema,
  messageNeedsLocationResponseSchema,
} from "./message-interpretation.js";
import {
  searchOrchestrationMatchedResponseSchema,
  searchOrchestrationNeedsLocationResponseSchema,
  searchOrchestrationNeedsServiceResponseSchema,
  searchOrchestrationNoMatchesResponseSchema,
} from "./search-orchestration.js";

export const messageSearchRequestSchema = messageInterpretationRequestSchema.extend({
  limit: z.number().int().min(1).max(10).default(3),
});

const interpretationNeedsLocationSchema = z.object({
  status: z.literal("needs_location"),
  stage: z.literal("interpretation"),
  reason: z.enum([
    "missing_explicit_location",
    "location_not_understood",
    "fallback_unavailable",
    "fallback_rate_limited",
    "fallback_provider_error",
  ]),
  interpretation: messageNeedsLocationResponseSchema,
  orchestration: z.null(),
}).strict();

const hybridMessageInterpretedResponseSchema = messageInterpretedResponseSchema.extend({
  interpretation: messageInterpretedResponseSchema.shape.interpretation.extend({
    location_strategy: z.enum(["locative_phrase", "llm_fallback"]),
  }),
});

function needsServiceSchema(reason: "unresolved" | "ambiguous") {
  return z.object({
    status: z.literal("needs_service"),
    stage: z.literal("service_resolution"),
    reason: z.literal(reason),
    interpretation: hybridMessageInterpretedResponseSchema,
    orchestration: searchOrchestrationNeedsServiceResponseSchema.extend({ reason: z.literal(reason) }),
  }).strict();
}

function needsLocationSchema(reason: "unresolved" | "ambiguous") {
  return z.object({
    status: z.literal("needs_location"),
    stage: z.literal("location_resolution"),
    reason: z.literal(reason),
    interpretation: hybridMessageInterpretedResponseSchema,
    orchestration: searchOrchestrationNeedsLocationResponseSchema.extend({ reason: z.literal(reason) }),
  }).strict();
}

const matchedSchema = z.object({
  status: z.literal("matched"),
  stage: z.literal("matching"),
  reason: z.null(),
  interpretation: hybridMessageInterpretedResponseSchema,
  orchestration: searchOrchestrationMatchedResponseSchema,
}).strict();

const noMatchesSchema = z.object({
  status: z.literal("no_matches"),
  stage: z.literal("matching"),
  reason: z.null(),
  interpretation: hybridMessageInterpretedResponseSchema,
  orchestration: searchOrchestrationNoMatchesResponseSchema,
}).strict();

export const messageSearchResponseSchema = z.union([
  interpretationNeedsLocationSchema,
  needsServiceSchema("unresolved"),
  needsServiceSchema("ambiguous"),
  needsLocationSchema("unresolved"),
  needsLocationSchema("ambiguous"),
  matchedSchema,
  noMatchesSchema,
]);
