import { z } from "zod";
import { locationResolutionResponseSchema } from "./location-resolution.js";
import { matchingSearchResponseSchema } from "./matching.js";
import { serviceResolutionResponseSchema } from "./service-resolution.js";

const countryCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/);

export const searchOrchestrationRequestSchema = z.object({
  raw_text: z.string().trim().min(1).max(2_000),
  service_text: z.string().trim().min(1).max(2_000),
  location_text: z.string().trim().min(2).max(500),
  country_code: countryCodeSchema.default("BR"),
  limit: z.number().int().min(1).max(10).default(3),
}).strict();

const needsServiceResponseSchema = z.object({
  status: z.literal("needs_service"),
  reason: z.enum(["unresolved", "ambiguous"]),
  service_resolution: serviceResolutionResponseSchema,
  location_resolution: z.null(),
  matching: z.null(),
});

const needsLocationResponseSchema = z.object({
  status: z.literal("needs_location"),
  reason: z.enum(["unresolved", "ambiguous"]),
  service_resolution: serviceResolutionResponseSchema,
  location_resolution: locationResolutionResponseSchema,
  matching: z.null(),
});

const matchedResponseSchema = z.object({
  status: z.literal("matched"),
  reason: z.null(),
  service_resolution: serviceResolutionResponseSchema,
  location_resolution: locationResolutionResponseSchema,
  matching: matchingSearchResponseSchema.refine((value) => value.matches.length > 0),
});

const noMatchesResponseSchema = z.object({
  status: z.literal("no_matches"),
  reason: z.null(),
  service_resolution: serviceResolutionResponseSchema,
  location_resolution: locationResolutionResponseSchema,
  matching: matchingSearchResponseSchema.refine((value) => value.matches.length === 0),
});

export const searchOrchestrationResponseSchema = z.discriminatedUnion("status", [
  needsServiceResponseSchema,
  needsLocationResponseSchema,
  matchedResponseSchema,
  noMatchesResponseSchema,
]);
