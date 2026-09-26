import { z } from "zod";
import { createProfessionalSchema, professionalResponseSchema, professionalStatusSchema } from "./professional.js";
import { professionalServiceResponseSchema, serviceCatalogItemSchema } from "./professional-service.js";
import { serviceAreaResponseSchema } from "./service-area.js";
import { professionalEntitlementSnapshotSchema } from "./professional-subscription.js";

export const createSelfServiceProfessionalSchema = createProfessionalSchema;
export const professionalEligibilityReasonSchema = z.enum([
  "identity_unverified", "profile_incomplete", "no_active_service", "no_service_area",
  "profile_draft", "profile_suspended",
]);
export const professionalEligibilitySchema = z.object({
  policy_version: z.literal("eligibility-v1"), professional_id: z.string().uuid(),
  identity_verified: z.boolean(), profile_complete: z.boolean(), has_active_service: z.boolean(),
  has_service_area: z.boolean(), profile_status: professionalStatusSchema, ready_to_publish: z.boolean(),
  can_appear_in_matching: z.boolean(), can_receive_opportunities: z.boolean(),
  can_set_available_now: z.boolean(), reasons: z.array(professionalEligibilityReasonSchema),
}).strict();

export const professionalLifecycleResponseSchema = z.object({
  professional: professionalResponseSchema, eligibility: professionalEligibilitySchema,
}).strict();
export const professionalDashboardAggregateSchema = z.object({
  professional: professionalResponseSchema, services: z.array(professionalServiceResponseSchema),
  areas: z.array(serviceAreaResponseSchema), catalog: z.array(serviceCatalogItemSchema),
  eligibility: professionalEligibilitySchema,
  entitlement: professionalEntitlementSnapshotSchema,
}).strict();

