import type { z } from "zod";
import type { matchingSearchRequestSchema, matchingSearchResponseSchema } from "../schemas/matching.js";

export type MatchingSearchInput = z.infer<typeof matchingSearchRequestSchema>;
export type MatchingSearchResponse = z.infer<typeof matchingSearchResponseSchema>;
