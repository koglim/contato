import { z } from "zod";
import {
  claimableProfessionalSchema,
  claimableProfessionalsResponseSchema,
  claimProfessionalInputSchema,
  claimProfessionalResponseSchema,
} from "../schemas/professional-claim.js";

export type ClaimableProfessional = z.infer<typeof claimableProfessionalSchema>;
export type ClaimableProfessionalsResponse = z.infer<typeof claimableProfessionalsResponseSchema>;
export type ClaimProfessionalInput = z.infer<typeof claimProfessionalInputSchema>;
export type ClaimProfessionalResponse = z.infer<typeof claimProfessionalResponseSchema>;
