import type { z } from "zod";
import type { createSelfServiceProfessionalSchema, professionalDashboardAggregateSchema,
  professionalEligibilityReasonSchema, professionalEligibilitySchema,
  professionalLifecycleResponseSchema } from "../schemas/professional-onboarding.js";
export type CreateSelfServiceProfessionalInput = z.infer<typeof createSelfServiceProfessionalSchema>;
export type ProfessionalEligibilityReason = z.infer<typeof professionalEligibilityReasonSchema>;
export type ProfessionalEligibility = z.infer<typeof professionalEligibilitySchema>;
export type ProfessionalLifecycleResponse = z.infer<typeof professionalLifecycleResponseSchema>;
export type ProfessionalDashboardAggregate = z.infer<typeof professionalDashboardAggregateSchema>;
