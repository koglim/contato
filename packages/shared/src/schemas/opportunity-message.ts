import { z } from "zod";

export const opportunityMessageSchema = z.object({
  route: z.literal("opportunity"),
  result: z.object({
    kind: z.enum([
      "accepted",
      "declined",
      "clarification",
      "unavailable",
      "resumed",
      "kept",
      "expired",
      "acknowledged",
      "unavailability_declared",
    ]),
    public_code: z.string().regex(/^CC-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/u).optional(),
    text: z.string().min(1).max(2000),
  }).strict(),
}).strict();
