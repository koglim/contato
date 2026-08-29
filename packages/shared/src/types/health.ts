import type { healthResponseSchema } from "../schemas/health.js";
import type { z } from "zod";

export type HealthResponse = z.infer<typeof healthResponseSchema>;
