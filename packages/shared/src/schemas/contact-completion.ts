import { z } from "zod";

export const contactCompletionStateSchema = z.enum([
  "pending_confirmation",
  "confirmed",
  "contested",
]);
export type ContactCompletionState = z.infer<typeof contactCompletionStateSchema>;

export const contactCompletionActorRoleSchema = z.enum(["customer", "professional"]);
export type ContactCompletionActorRole = z.infer<typeof contactCompletionActorRoleSchema>;

export const contactCompletionActionSchema = z.enum(["declared", "confirmed", "contested"]);
export type ContactCompletionAction = z.infer<typeof contactCompletionActionSchema>;

export const contactCompletionPublicCodeSchema = z
  .string()
  .regex(/^CC-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/u);

export const contactCompletionCommandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("declare"),
    code: contactCompletionPublicCodeSchema,
  }),
  z.object({
    kind: z.literal("confirm"),
    code: contactCompletionPublicCodeSchema,
  }),
  z.object({
    kind: z.literal("contest"),
    code: contactCompletionPublicCodeSchema,
  }),
]);
export type ContactCompletionCommand = z.infer<typeof contactCompletionCommandSchema>;

export const contactCompletionRecordSchema = z.object({
  id: z.string().uuid(),
  contact_id: z.string().uuid(),
  state: contactCompletionStateSchema,
  declared_by: contactCompletionActorRoleSchema,
  declared_at: z.string().datetime(),
  confirmed_at: z.string().datetime().nullable(),
  contested_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type ContactCompletionRecord = z.infer<typeof contactCompletionRecordSchema>;

export const contactCompletionEventRecordSchema = z.object({
  id: z.string().uuid(),
  completion_id: z.string().uuid(),
  contact_id: z.string().uuid(),
  actor_role: contactCompletionActorRoleSchema,
  action: contactCompletionActionSchema,
  inbound_message_id: z.string().uuid(),
  created_at: z.string().datetime(),
});
export type ContactCompletionEventRecord = z.infer<typeof contactCompletionEventRecordSchema>;

export const contactCompletionMessageSchema = z.object({
  route: z.literal("contact_completion"),
  action: z.enum(["declared", "confirmed", "contested", "clarification", "unavailable", "idempotent_replay"]),
  public_code: contactCompletionPublicCodeSchema.optional(),
  contact_id: z.string().uuid().optional(),
  completion_id: z.string().uuid().optional(),
  event_id: z.string().uuid().optional(),
  state: contactCompletionStateSchema.optional(),
  reply_text: z.string().min(1).max(2000),
});
export type ContactCompletionMessage = z.infer<typeof contactCompletionMessageSchema>;
