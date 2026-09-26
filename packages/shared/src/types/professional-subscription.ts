import type { z } from "zod";
import type {
  subscriptionPlanCodeSchema,
  subscriptionPlanEntitlementKeySchema,
  subscriptionPlanSchema,
  professionalEntitlementStateSchema,
  professionalEntitlementReasonSchema,
  professionalEntitlementSnapshotSchema,
  grantProfessionalSubscriptionSchema,
  extendProfessionalSubscriptionSchema,
  reactivateProfessionalSubscriptionSchema,
  professionalSubscriptionEventActionSchema,
  professionalSubscriptionEventSourceSchema,
  professionalSubscriptionEventSchema,
} from "../schemas/professional-subscription.js";

export type SubscriptionPlanCode = z.infer<typeof subscriptionPlanCodeSchema>;
export type SubscriptionPlanEntitlementKey = z.infer<typeof subscriptionPlanEntitlementKeySchema>;
export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>;
export type ProfessionalEntitlementState = z.infer<typeof professionalEntitlementStateSchema>;
export type ProfessionalEntitlementReason = z.infer<typeof professionalEntitlementReasonSchema>;
export type ProfessionalEntitlementSnapshot = z.infer<typeof professionalEntitlementSnapshotSchema>;
export type GrantProfessionalSubscriptionInput = z.infer<typeof grantProfessionalSubscriptionSchema>;
export type ExtendProfessionalSubscriptionInput = z.infer<typeof extendProfessionalSubscriptionSchema>;
export type ReactivateProfessionalSubscriptionInput = z.infer<typeof reactivateProfessionalSubscriptionSchema>;
export type ProfessionalSubscriptionEventAction = z.infer<typeof professionalSubscriptionEventActionSchema>;
export type ProfessionalSubscriptionEventSource = z.infer<typeof professionalSubscriptionEventSourceSchema>;
export type ProfessionalSubscriptionEvent = z.infer<typeof professionalSubscriptionEventSchema>;
