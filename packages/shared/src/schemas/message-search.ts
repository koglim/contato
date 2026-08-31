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
  reason: z.literal("missing_explicit_location"),
  interpretation: messageNeedsLocationResponseSchema,
  orchestration: z.null(),
}).strict();

function needsServiceSchema(reason: "unresolved" | "ambiguous") {
  return z.object({
    status: z.literal("needs_service"),
    stage: z.literal("service_resolution"),
    reason: z.literal(reason),
    interpretation: messageInterpretedResponseSchema,
    orchestration: searchOrchestrationNeedsServiceResponseSchema.extend({ reason: z.literal(reason) }),
  }).strict();
}

function needsLocationSchema(reason: "unresolved" | "ambiguous") {
  return z.object({
    status: z.literal("needs_location"),
    stage: z.literal("location_resolution"),
    reason: z.literal(reason),
    interpretation: messageInterpretedResponseSchema,
    orchestration: searchOrchestrationNeedsLocationResponseSchema.extend({ reason: z.literal(reason) }),
  }).strict();
}

const matchedSchema = z.object({
  status: z.literal("matched"),
  stage: z.literal("matching"),
  reason: z.null(),
  interpretation: messageInterpretedResponseSchema,
  orchestration: searchOrchestrationMatchedResponseSchema,
}).strict();

const noMatchesSchema = z.object({
  status: z.literal("no_matches"),
  stage: z.literal("matching"),
  reason: z.null(),
  interpretation: messageInterpretedResponseSchema,
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
