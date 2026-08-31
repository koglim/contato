import type { z } from "zod";
import type {
  searchOrchestrationRequestSchema,
  searchOrchestrationResponseSchema,
} from "../schemas/search-orchestration.js";

export type SearchOrchestrationInput = z.infer<typeof searchOrchestrationRequestSchema>;
export type SearchOrchestrationResponse = z.infer<typeof searchOrchestrationResponseSchema>;
