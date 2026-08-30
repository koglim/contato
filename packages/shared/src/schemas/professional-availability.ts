import { z } from "zod";

export const updateProfessionalAvailabilitySchema = z
  .object({ is_available_now: z.boolean() })
  .strict();

export const professionalAvailabilityResponseSchema = z.object({
  professional_id: z.string().uuid(),
  is_available_now: z.boolean(),
  available_now_updated_at: z.string().datetime({ offset: true }),
});
