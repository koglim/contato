import { z } from "zod";
import { phoneE164Schema } from "./phone.js";

const selectedSelectionMessageSchema = z.object({
  kind: z.literal("selected"),
  professional_name: z.string().trim().min(1).max(255),
  service_name: z.string().trim().min(1).max(120),
  professional_phone_e164: phoneE164Schema,
  replayed: z.boolean(),
}).strict();

export const selectionMessageContractSchema = z.discriminatedUnion("kind", [
  selectedSelectionMessageSchema,
  z.object({
    kind: z.literal("invalid_selection"),
    requested_position: z.number().int().positive(),
    visible_match_count: z.number().int().nonnegative(),
  }).strict(),
  z.object({ kind: z.literal("not_command") }).strict(),
  z.object({ kind: z.literal("no_more_options") }).strict(),
  z.object({
    kind: z.literal("show_more_requested"),
    shown_match_count: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    kind: z.literal("global_command"),
    command: z.enum(["cancel", "restart", "help"]),
  }).strict(),
  z.object({
    kind: z.literal("selection_unavailable"),
    reason: z.enum([
      "conversation_not_found",
      "conversation_not_active",
      "conversation_expired",
      "conversation_customer_mismatch",
      "search_request_not_selectable",
      "match_not_available",
      "idempotency_conflict",
      "missing_conversation_id",
      "missing_customer_id",
      "missing_search_request_id",
      "not_awaiting_selection",
    ]),
  }).strict(),
]);
