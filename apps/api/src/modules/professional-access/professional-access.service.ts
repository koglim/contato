import { PostgresProfessionalAccessRepository } from "./professional-access.repository.js";
import { professionalAccessQuerySchema, type ProfessionalAccessQuery,
  type ProfessionalAccessReader, type ProfessionalAccessResult } from "./professional-access.types.js";

export class ProfessionalAccessService {
  constructor(private readonly repository: ProfessionalAccessReader = new PostgresProfessionalAccessRepository()) {}

  async resolveProfessionalAccess(input: ProfessionalAccessQuery): Promise<ProfessionalAccessResult> {
    const query = professionalAccessQuerySchema.parse(input);
    const state = await this.repository.findSnapshot(query);
    if (!state.accountStatus || !state.professionalExists) return { status: "not_found" };
    if (state.accountStatus === "blocked") return { status: "account_blocked" };
    if (!state.membershipStatus) return { status: "not_member" };
    if (state.membershipStatus === "revoked") return { status: "membership_revoked" };
    if (!state.hasVerifiedIdentifier) return { status: "identity_unverified" };
    return { status: "authorized" };
  }
}
