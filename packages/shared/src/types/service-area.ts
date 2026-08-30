import type { z } from "zod";
import type {
  createServiceAreaSchema,
  serviceAreaResponseSchema,
  updateServiceAreaSchema,
} from "../schemas/service-area.js";

export type CreateServiceAreaInput = z.infer<typeof createServiceAreaSchema>;
export type UpdateServiceAreaInput = z.infer<typeof updateServiceAreaSchema>;
export type ServiceAreaResponse = z.infer<typeof serviceAreaResponseSchema>;
