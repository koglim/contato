import type { z } from "zod";
import type {
  professionalAvailabilityResponseSchema,
  updateProfessionalAvailabilitySchema,
} from "../schemas/professional-availability.js";

export type UpdateProfessionalAvailabilityInput = z.infer<typeof updateProfessionalAvailabilitySchema>;
export type ProfessionalAvailabilityResponse = z.infer<typeof professionalAvailabilityResponseSchema>;
