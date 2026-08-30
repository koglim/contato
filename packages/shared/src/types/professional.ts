import type { z } from "zod";
import type {
  createProfessionalSchema,
  listProfessionalsQuerySchema,
  professionalResponseSchema,
  professionalStatusSchema,
  updateProfessionalSchema,
} from "../schemas/professional.js";

export type CreateProfessionalInput = z.infer<typeof createProfessionalSchema>;
export type UpdateProfessionalInput = z.infer<typeof updateProfessionalSchema>;
export type ProfessionalResponse = z.infer<typeof professionalResponseSchema>;
export type ProfessionalStatus = z.infer<typeof professionalStatusSchema>;
export type ListProfessionalsQuery = z.infer<typeof listProfessionalsQuerySchema>;
