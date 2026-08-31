import type { z } from "zod";
import type {
  locationResolutionRequestSchema,
  locationResolutionResponseSchema,
} from "../schemas/location-resolution.js";

export type LocationResolutionInput = z.infer<typeof locationResolutionRequestSchema>;
export type LocationResolutionResponse = z.infer<typeof locationResolutionResponseSchema>;
export type LocationResolutionCandidate = z.infer<typeof import("../schemas/location-resolution.js").locationResolutionCandidateSchema>;
