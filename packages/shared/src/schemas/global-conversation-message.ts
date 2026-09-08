import { z } from "zod";

export const globalConversationMessageContractSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cancelled") }).strict(),
  z.object({ kind: z.literal("restarted") }).strict(),
  z.object({
    kind: z.literal("help"),
    pending_slot: z.enum(["location", "service", "selection"]).nullable(),
  }).strict(),
  z.object({ kind: z.literal("no_active_conversation") }).strict(),
]);
