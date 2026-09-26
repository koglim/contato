import { z } from "zod";
import { professionalStatusSchema } from "./professional.js";

export const claimableProfessionalSchema = z
  .object({
    id: z.string().uuid(),
    display_name: z.string(),
    slug: z.string(),
    status: professionalStatusSchema,
  })
  .strict();

export const claimableProfessionalsResponseSchema = z
  .object({
    items: z.array(claimableProfessionalSchema),
  })
  .strict();

export const claimProfessionalInputSchema = z
  .object({
    professional_id: z.string().uuid(),
  })
  .strict();

export const claimProfessionalResponseSchema = z
  .object({
    claimed: z.literal(true),
    professional: claimableProfessionalSchema,
  })
  .strict();
