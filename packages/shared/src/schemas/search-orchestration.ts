import { z } from "zod";
import { locationResolutionResponseSchema } from "./location-resolution.js";
import { matchingSearchResponseSchema } from "./matching.js";
import { serviceResolutionResponseSchema } from "./service-resolution.js";

const countryCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/);

export const searchOrchestrationCoordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  city: z.string().trim().max(120).nullable().optional(),
  state: z.string().trim().length(2).nullable().optional(),
  neighborhood: z.string().trim().max(120).nullable().optional(),
  label: z.string().trim().max(200).optional(),
  source: z.string().trim().max(60).optional(),
}).strict();

export const searchOrchestrationRequestSchema = z.object({
  raw_text: z.string().trim().min(1).max(2_000),
  service_text: z.string().trim().min(1).max(2_000),
  location_text: z.string().trim().min(2).max(500),
  country_code: countryCodeSchema.default("BR"),
  limit: z.number().int().min(1).max(10).default(3),
  coordinates: searchOrchestrationCoordinatesSchema.optional(),
}).strict();

export const searchOrchestrationNeedsServiceResponseSchema = z.object({
  status: z.literal("needs_service"),
  reason: z.enum(["unresolved", "ambiguous"]),
  service_resolution: serviceResolutionResponseSchema,
  location_resolution: z.null(),
  matching: z.null(),
});

export const searchOrchestrationNeedsLocationResponseSchema = z.object({
  status: z.literal("needs_location"),
  reason: z.enum(["unresolved", "ambiguous"]),
  service_resolution: serviceResolutionResponseSchema,
  location_resolution: locationResolutionResponseSchema,
  matching: z.null(),
});

export const searchOrchestrationMatchedResponseSchema = z.object({
  status: z.literal("matched"),
  reason: z.null(),
  service_resolution: serviceResolutionResponseSchema,
  location_resolution: locationResolutionResponseSchema,
  matching: matchingSearchResponseSchema.refine((value) => value.matches.length > 0),
});

export const searchOrchestrationNoMatchesResponseSchema = z.object({
  status: z.literal("no_matches"),
  reason: z.null(),
  service_resolution: serviceResolutionResponseSchema,
  location_resolution: locationResolutionResponseSchema,
  matching: matchingSearchResponseSchema.refine((value) => value.matches.length === 0),
});

export const searchOrchestrationResponseSchema = z.discriminatedUnion("status", [
  searchOrchestrationNeedsServiceResponseSchema,
  searchOrchestrationNeedsLocationResponseSchema,
  searchOrchestrationMatchedResponseSchema,
  searchOrchestrationNoMatchesResponseSchema,
]);
