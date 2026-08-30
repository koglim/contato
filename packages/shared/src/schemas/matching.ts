import { z } from "zod";
import { priceModeSchema } from "./professional-service.js";

const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const matchingSearchRequestSchema = coordinatesSchema.extend({
  raw_text: z.string().trim().min(1).max(2_000),
  service_id: z.string().uuid(),
  city: z.string().trim().min(1).max(120).optional(),
  state: z.string().trim().min(1).max(120).optional(),
  neighborhood: z.string().trim().min(1).max(120).nullable().optional(),
  limit: z.number().int().min(1).max(10).default(3),
}).strict();

export const matchingSearchResponseSchema = z.object({
  search_request_id: z.string().uuid(),
  status: z.enum(["ready", "matched"]),
  service: z.object({ id: z.string().uuid(), name: z.string(), slug: z.string() }),
  location: coordinatesSchema.extend({
    city: z.string().nullable(),
    state: z.string().nullable(),
    neighborhood: z.string().nullable(),
  }),
  matches: z.array(z.object({
    match_id: z.string().uuid(),
    rank_position: z.number().int().positive(),
    distance_meters: z.number().int().nonnegative(),
    effective_available_now: z.boolean(),
    professional: z.object({
      id: z.string().uuid(), display_name: z.string(), slug: z.string(), bio: z.string().nullable(),
      profile_image_url: z.string().nullable(), is_verified: z.boolean(),
    }),
    service: z.object({
      professional_service_id: z.string().uuid(), description: z.string().nullable(), price_mode: priceModeSchema,
      price_from_cents: z.number().int().nullable(), price_to_cents: z.number().int().nullable(),
    }),
    service_area: z.object({
      id: z.string().uuid(), label: z.string().nullable(), city: z.string(), state: z.string(), radius_meters: z.number().int(),
    }),
  })),
  meta: z.object({ count: z.number().int().nonnegative(), limit: z.number().int().positive(), availability_freshness_minutes: z.number().int().positive() }),
});
