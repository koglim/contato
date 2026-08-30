import type { z } from "zod";
import type {
  serviceResolutionRequestSchema,
  serviceResolutionResponseSchema,
} from "../schemas/service-resolution.js";

export type ServiceResolutionInput = z.infer<typeof serviceResolutionRequestSchema>;
export type ServiceResolutionResponse = z.infer<typeof serviceResolutionResponseSchema>;
