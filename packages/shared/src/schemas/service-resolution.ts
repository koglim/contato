import { z } from "zod";

const serviceReferenceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
});

const serviceResolutionCandidateSchema = z.object({
  service: serviceReferenceSchema,
  method: z.enum(["exact", "phrase", "fuzzy"]),
  matched_term: z.string(),
  confidence: z.number().min(0).max(1),
});

export const serviceResolutionRequestSchema = z.object({
  text: z.string().trim().min(1).max(2_000),
}).strict();

export const serviceResolutionResponseSchema = z.object({
  status: z.enum(["resolved", "ambiguous", "unresolved"]),
  normalized_text: z.string(),
  match: serviceResolutionCandidateSchema.nullable(),
  candidates: z.array(serviceResolutionCandidateSchema).max(3),
});
