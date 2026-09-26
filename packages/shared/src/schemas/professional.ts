import { z } from "zod";

const e164PhoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/, "phone_e164 must be in E.164 format");
const optionalTextSchema = z.string().trim().min(1, "Must not be empty");

export const professionalStatusSchema = z.enum(["draft", "active", "suspended"]);
export const professionalManagementModeSchema = z.enum(["legacy_unmanaged", "account_managed"]);

export const createProfessionalSchema = z
  .object({
    display_name: z.string().trim().min(2).max(255),
    phone_e164: e164PhoneSchema,
    email: z.string().trim().email().max(320).optional(),
    bio: optionalTextSchema.max(2_000).optional(),
    profile_image_url: z.string().trim().url().max(2_048).optional(),
  })
  .strict();

export const updateProfessionalSchema = z
  .object({
    display_name: z.string().trim().min(2).max(255).optional(),
    phone_e164: e164PhoneSchema.optional(),
    email: z.string().trim().email().max(320).nullable().optional(),
    bio: optionalTextSchema.max(2_000).nullable().optional(),
    profile_image_url: z.string().trim().url().max(2_048).nullable().optional(),
    status: professionalStatusSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field must be provided");

export const professionalResponseSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string(),
  slug: z.string(),
  bio: z.string().nullable(),
  phone_e164: z.string(),
  email: z.string().nullable(),
  profile_image_url: z.string().nullable(),
  status: professionalStatusSchema,
  management_mode: professionalManagementModeSchema.default("legacy_unmanaged"),
  is_verified: z.boolean(),
  is_available_now: z.boolean(),
  available_now_updated_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export const listProfessionalsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: professionalStatusSchema.optional(),
  q: z.string().trim().min(1).max(255).optional(),
});
