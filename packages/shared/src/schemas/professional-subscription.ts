import { z } from "zod";
import { professionalManagementModeSchema } from "./professional.js";

export const subscriptionPlanCodeSchema = z.string().trim().min(1).max(64);
export const subscriptionPlanEntitlementKeySchema = z.enum(["marketplace_access"]);

export const subscriptionPlanSchema = z
  .object({
    id: z.string().uuid(),
    code: subscriptionPlanCodeSchema,
    name: z.string().trim().min(1).max(255),
    is_active: z.boolean(),
    entitlements: z.array(subscriptionPlanEntitlementKeySchema),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict();

export const professionalEntitlementStateSchema = z.enum([
  "legacy_exempt",
  "none",
  "not_started",
  "active",
  "expired",
  "revoked",
  "plan_inactive",
]);

export const professionalEntitlementReasonSchema = z.enum([
  "subscription_required",
  "subscription_not_started",
  "subscription_expired",
  "subscription_revoked",
  "subscription_plan_inactive",
]);

export const professionalEntitlementSnapshotSchema = z
  .object({
    policy_version: z.literal("entitlement-v1"),
    professional_id: z.string().uuid(),
    management_mode: professionalManagementModeSchema,
    subscription_required: z.boolean(),
    state: professionalEntitlementStateSchema,
    plan_code: z.string().nullable(),
    starts_at: z.string().datetime({ offset: true }).nullable(),
    ends_at: z.string().datetime({ offset: true }).nullable(),
    has_marketplace_access: z.boolean(),
    reasons: z.array(professionalEntitlementReasonSchema),
  })
  .strict();

export const grantProfessionalSubscriptionSchema = z
  .object({
    plan_code: subscriptionPlanCodeSchema,
    starts_at: z.string().datetime({ offset: true }),
    ends_at: z.string().datetime({ offset: true }),
  })
  .strict()
  .refine(
    (data) => new Date(data.ends_at).getTime() > new Date(data.starts_at).getTime(),
    { message: "ends_at must be strictly after starts_at", path: ["ends_at"] }
  );

export const extendProfessionalSubscriptionSchema = z
  .object({
    ends_at: z.string().datetime({ offset: true }),
  })
  .strict();

export const reactivateProfessionalSubscriptionSchema = z
  .object({
    plan_code: subscriptionPlanCodeSchema.optional(),
    starts_at: z.string().datetime({ offset: true }),
    ends_at: z.string().datetime({ offset: true }),
  })
  .strict()
  .refine(
    (data) => new Date(data.ends_at).getTime() > new Date(data.starts_at).getTime(),
    { message: "ends_at must be strictly after starts_at", path: ["ends_at"] }
  );

export const professionalSubscriptionEventActionSchema = z.enum([
  "granted",
  "extended",
  "revoked",
  "reactivated",
]);

export const professionalSubscriptionEventSourceSchema = z.enum([
  "internal_provisioning",
]);

export const professionalSubscriptionEventSchema = z
  .object({
    id: z.string().uuid(),
    subscription_id: z.string().uuid(),
    professional_id: z.string().uuid(),
    action: professionalSubscriptionEventActionSchema,
    source: professionalSubscriptionEventSourceSchema,
    previous_starts_at: z.string().datetime({ offset: true }).nullable(),
    new_starts_at: z.string().datetime({ offset: true }).nullable(),
    previous_ends_at: z.string().datetime({ offset: true }).nullable(),
    new_ends_at: z.string().datetime({ offset: true }).nullable(),
    created_at: z.string().datetime({ offset: true }),
  })
  .strict();
