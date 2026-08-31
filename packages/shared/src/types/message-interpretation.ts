import type { z } from "zod";
import type {
  messageInterpretationRequestSchema,
  messageInterpretationResponseSchema,
} from "../schemas/message-interpretation.js";

export type MessageInterpretationInput = z.infer<typeof messageInterpretationRequestSchema>;
export type MessageInterpretationResponse = z.infer<typeof messageInterpretationResponseSchema>;
