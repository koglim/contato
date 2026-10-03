import { z } from "zod";

export const interactiveActionTypeSchema = z.enum([
  "declare_completion",
  "declare_unavailability",
  "confirm_completion",
  "contest_completion",
]);
export type InteractiveActionType = z.infer<typeof interactiveActionTypeSchema>;

export const interactiveActionTokenStatusSchema = z.enum([
  "active",
  "consumed",
  "revoked",
  "expired",
]);
export type InteractiveActionTokenStatus = z.infer<typeof interactiveActionTokenStatusSchema>;

export const interactiveOutboundActionSchema = z
  .object({
    action_id: z.string().min(1),
    label: z.string().trim().min(1),
  })
  .strict();
export type InteractiveOutboundAction = z.infer<typeof interactiveOutboundActionSchema>;

export const interactiveOutboundPayloadSchema = z
  .object({
    schema_version: z.literal(1),
    type: z.literal("button_group"),
    body: z.string().trim().min(1),
    actions: z.array(interactiveOutboundActionSchema).min(1),
  })
  .strict();
export type InteractiveOutboundPayload = z.infer<typeof interactiveOutboundPayloadSchema>;
