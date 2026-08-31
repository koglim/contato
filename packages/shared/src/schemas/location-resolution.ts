import { z } from "zod";

const countryCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/);

export const locationResolutionCandidateSchema = z.object({
  label: z.string(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  city: z.string().nullable(),
  state: z.string().nullable(),
  country_code: countryCodeSchema,
  neighborhood: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  layer: z.string().nullable(),
});

export const locationResolutionRequestSchema = z.object({
  query: z.string().trim().min(2).max(500).transform((value) => value.replace(/\s+/gu, " ")),
  country_code: countryCodeSchema.default("BR"),
  limit: z.number().int().min(1).max(10).default(5),
}).strict();

export const locationResolutionResponseSchema = z.object({
  status: z.enum(["resolved", "ambiguous", "unresolved"]),
  query: z.string(),
  country_code: countryCodeSchema,
  match: locationResolutionCandidateSchema.nullable(),
  candidates: z.array(locationResolutionCandidateSchema).max(10),
  provider: z.string().min(1),
});
