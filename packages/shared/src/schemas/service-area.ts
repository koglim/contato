import { z } from "zod";

const optionalText = (max: number) => z.string().trim().min(1, "Must not be empty").max(max);
const latitudeSchema = z.number().min(-90).max(90);
const longitudeSchema = z.number().min(-180).max(180);
const radiusMetersSchema = z.number().int().min(1).max(200_000);

export const createServiceAreaSchema = z
  .object({
    label: optionalText(255).optional(),
    city: optionalText(120),
    state: optionalText(120).min(2),
    country_code: z.string().trim().regex(/^[a-zA-Z]{2}$/, "Must contain exactly two letters").transform((value) => value.toUpperCase()),
    neighborhood: optionalText(120).nullable().optional(),
    latitude: latitudeSchema,
    longitude: longitudeSchema,
    radius_meters: radiusMetersSchema,
    is_primary: z.boolean().default(false),
  })
  .strict();

export const updateServiceAreaSchema = z
  .object({
    label: optionalText(255).nullable().optional(),
    city: optionalText(120).optional(),
    state: optionalText(120).min(2).optional(),
    country_code: z.string().trim().regex(/^[a-zA-Z]{2}$/, "Must contain exactly two letters").transform((value) => value.toUpperCase()).optional(),
    neighborhood: optionalText(120).nullable().optional(),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
    radius_meters: radiusMetersSchema.optional(),
    is_primary: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field must be provided");

export const serviceAreaResponseSchema = z.object({
  id: z.string().uuid(),
  professional_id: z.string().uuid(),
  label: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  country_code: z.string().length(2),
  neighborhood: z.string().nullable(),
  latitude: z.number(),
  longitude: z.number(),
  radius_meters: z.number().int(),
  is_primary: z.boolean(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
