import { z } from "zod";

const countryCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/);

export const messageInterpretationRequestSchema = z.object({
  raw_text: z.string().trim().min(1).max(2_000),
  country_code: countryCodeSchema.default("BR"),
}).strict();

const baseResponseSchema = z.object({
  raw_text: z.string(),
  service_text: z.string(),
  country_code: countryCodeSchema,
  interpretation: z.object({
    service_strategy: z.literal("full_message"),
  }),
});

export const messageInterpretedResponseSchema = baseResponseSchema.extend({
  status: z.literal("interpreted"),
  location_text: z.string().min(1),
  interpretation: baseResponseSchema.shape.interpretation.extend({
    location_strategy: z.literal("locative_phrase"),
  }),
});

export const messageNeedsLocationResponseSchema = baseResponseSchema.extend({
  status: z.literal("needs_location"),
  location_text: z.null(),
  interpretation: baseResponseSchema.shape.interpretation.extend({
    location_strategy: z.literal("none"),
  }),
});

export const messageInterpretationResponseSchema = z.discriminatedUnion("status", [
  messageInterpretedResponseSchema,
  messageNeedsLocationResponseSchema,
]);
