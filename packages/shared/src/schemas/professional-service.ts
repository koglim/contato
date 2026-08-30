import { z } from "zod";

const optionalDescriptionSchema = z.string().trim().min(1, "Must not be empty").max(2_000);
const centsSchema = z.number().int().min(0);

export const priceModeSchema = z.enum(["quote", "fixed", "from", "range"]);

export const serviceCategorySummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
});

export const serviceSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  category: serviceCategorySummarySchema,
});

export const serviceCatalogItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  is_active: z.boolean(),
  category: serviceCategorySummarySchema,
});

export const createProfessionalServiceSchema = z
  .object({
    service_id: z.string().uuid(),
    description: optionalDescriptionSchema.optional(),
    price_mode: priceModeSchema,
    price_from_cents: centsSchema.optional(),
    price_to_cents: centsSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.price_mode === "quote") {
      if (value.price_from_cents !== undefined || value.price_to_cents !== undefined) {
        context.addIssue({ code: "custom", message: "quote does not accept price values" });
      }
      return;
    }

    if (value.price_from_cents === undefined) {
      context.addIssue({ code: "custom", path: ["price_from_cents"], message: "Required for this price_mode" });
    }

    if (value.price_mode === "range") {
      if (value.price_to_cents === undefined) {
        context.addIssue({ code: "custom", path: ["price_to_cents"], message: "Required for range" });
      } else if (value.price_from_cents !== undefined && value.price_to_cents < value.price_from_cents) {
        context.addIssue({ code: "custom", path: ["price_to_cents"], message: "Must be greater than or equal to price_from_cents" });
      }
    } else if (value.price_to_cents !== undefined) {
      context.addIssue({ code: "custom", path: ["price_to_cents"], message: "Only allowed for range" });
    }
  });

export const updateProfessionalServiceSchema = z
  .object({
    description: optionalDescriptionSchema.nullable().optional(),
    price_mode: priceModeSchema.optional(),
    price_from_cents: centsSchema.nullable().optional(),
    price_to_cents: centsSchema.nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field must be provided");

export const professionalServiceResponseSchema = z.object({
  id: z.string().uuid(),
  professional_id: z.string().uuid(),
  service_id: z.string().uuid(),
  description: z.string().nullable(),
  price_mode: priceModeSchema,
  price_from_cents: z.number().int().nullable(),
  price_to_cents: z.number().int().nullable(),
  is_active: z.boolean(),
  service: serviceSummarySchema,
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export const listCatalogServicesQuerySchema = z.object({
  q: z.string().trim().min(1).max(255).optional(),
  category_id: z.string().uuid().optional(),
});
