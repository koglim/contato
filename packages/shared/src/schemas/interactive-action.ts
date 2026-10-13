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
    action_id: z
      .string()
      .min(1)
      .max(120)
      .refine((v) => !/\s/.test(v), {
        message: "action_id must not contain whitespace",
      }),
    label: z.string().trim().min(1),
  })
  .strict();
export type InteractiveOutboundAction = z.infer<typeof interactiveOutboundActionSchema>;

export const interactiveButtonGroupPayloadSchema = z
  .object({
    schema_version: z.literal(1),
    type: z.literal("button_group"),
    body: z.string().trim().min(1),
    actions: z.array(interactiveOutboundActionSchema).min(1),
  })
  .strict()
  .refine(
    (payload) => {
      const ids = payload.actions.map((a) => a.action_id);
      return new Set(ids).size === ids.length;
    },
    { message: "action_id values must be unique within payload" }
  );
export type InteractiveButtonGroupPayload = z.infer<typeof interactiveButtonGroupPayloadSchema>;

export const interactiveTemplateQuickReplyPayloadSchema = z
  .object({
    schema_version: z.literal(1),
    type: z.literal("template_quick_reply"),
    template_name: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .regex(/^[a-z0-9_]+$/, {
        message: "template_name must be a lower-case Meta-safe identifier",
      }),
    language_code: z
      .string()
      .trim()
      .min(2)
      .max(10)
      .regex(/^[a-z]{2}(_[A-Z]{2})?$/, {
        message: "language_code must be standard format like pt_BR or en_US",
      }),
    body_parameters: z
      .array(z.string().trim().min(1).max(1024))
      .min(1)
      .max(15),
    actions: z.array(interactiveOutboundActionSchema).min(1).max(3),
  })
  .strict()
  .refine(
    (payload) => {
      const ids = payload.actions.map((a) => a.action_id);
      return new Set(ids).size === ids.length;
    },
    { message: "action_id values must be unique within payload" }
  );
export type InteractiveTemplateQuickReplyPayload = z.infer<
  typeof interactiveTemplateQuickReplyPayloadSchema
>;

export const interactiveTemplateAuthenticationPayloadSchema = z
  .object({
    schema_version: z.literal(1),
    type: z.literal("template_authentication"),
    template_name: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .regex(/^[a-z0-9_]+$/, {
        message: "template_name must be a lower-case Meta-safe identifier",
      }),
    language_code: z
      .string()
      .trim()
      .min(2)
      .max(10)
      .regex(/^[a-z]{2}(_[A-Z]{2})?$/, {
        message: "language_code must be standard format like pt_BR or en_US",
      }),
    otp_code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, {
        message: "otp_code must be exactly 6 digits",
      }),
  })
  .strict();
export type InteractiveTemplateAuthenticationPayload = z.infer<
  typeof interactiveTemplateAuthenticationPayloadSchema
>;

export const interactiveOutboundPayloadSchema = z.discriminatedUnion("type", [
  interactiveButtonGroupPayloadSchema,
  interactiveTemplateQuickReplyPayloadSchema,
  interactiveTemplateAuthenticationPayloadSchema,
]);
export type InteractiveOutboundPayload = z.infer<typeof interactiveOutboundPayloadSchema>;

export const INTERACTIVE_ACTION_TOKEN_TTL_DAYS = 30;

export const interactiveActionResultSchema = z
  .object({
    action: z.enum([
      "declared",
      "confirmed",
      "contested",
      "unavailability_declared",
      "idempotent_replay",
      "unavailable",
      "clarification",
    ]),
    action_type: interactiveActionTypeSchema.optional(),
    public_code: z.string().optional(),
    reply_text: z.string().trim().min(1).max(2_000),
  })
  .strict();
export type InteractiveActionResult = z.infer<typeof interactiveActionResultSchema>;

