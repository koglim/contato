import { z } from "zod";
export const requestProfessionalAuthChallengeSchema=z.object({phone_e164:z.string().regex(/^\+[1-9]\d{7,14}$/u)}).strict();
export const verifyProfessionalAuthChallengeSchema=z.object({challenge_reference:z.string().uuid(),code:z.string().regex(/^\d{6}$/u)}).strict();
export type SessionPrincipal={sessionId:string;accountId:string;expiresAt:Date};
