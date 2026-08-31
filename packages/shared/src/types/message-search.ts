import type { z } from "zod";
import type { messageSearchRequestSchema, messageSearchResponseSchema } from "../schemas/message-search.js";

export type MessageSearchInput = z.infer<typeof messageSearchRequestSchema>;
export type MessageSearchResponse = z.infer<typeof messageSearchResponseSchema>;
