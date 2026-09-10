import { z } from "zod";

// Additive Inbox result; memory, hypotheses and model metadata are never public.
export const contextualMessageSchema = z.object({
  route: z.literal("contextual"),
  customer_id: z.string().uuid(),
  status: z.enum(["needs_service", "needs_location", "clarification", "information", "matched", "no_matches", "fallback"]),
}).strict();
