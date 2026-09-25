import { z } from "zod";

export const professionalAccessQuerySchema = z.object({
  accountId: z.uuid(),
  professionalId: z.uuid(),
}).strict();

export const professionalMembershipInputSchema = professionalAccessQuerySchema.extend({
  role: z.enum(["owner", "admin", "member"]),
}).strict();

export type ProfessionalAccessQuery = z.infer<typeof professionalAccessQuerySchema>;
export type ProfessionalMembershipInput = z.infer<typeof professionalMembershipInputSchema>;
export type ProfessionalAccessStatus = "authorized" | "not_member" | "membership_revoked" | "account_blocked" | "identity_unverified" | "not_found";
export type ProfessionalAccessResult = { status: ProfessionalAccessStatus };

export type ProfessionalAccessSnapshot = {
  accountStatus: "active" | "blocked" | null;
  professionalExists: boolean;
  membershipStatus: "active" | "revoked" | null;
  hasVerifiedIdentifier: boolean;
};

export interface ProfessionalAccessReader {
  findSnapshot(input: ProfessionalAccessQuery): Promise<ProfessionalAccessSnapshot>;
}
