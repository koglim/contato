import type { z } from "zod";
import type {
  continueSearchConversationRequestSchema,
  continueSearchConversationResponseSchema,
  startSearchConversationRequestSchema,
  startSearchConversationResponseSchema,
} from "../schemas/search-conversation.js";

export type StartSearchConversationInput = z.infer<typeof startSearchConversationRequestSchema>;
export type StartSearchConversationResponse = z.infer<typeof startSearchConversationResponseSchema>;
export type ContinueSearchConversationInput = z.infer<typeof continueSearchConversationRequestSchema>;
export type ContinueSearchConversationResponse = z.infer<typeof continueSearchConversationResponseSchema>;
