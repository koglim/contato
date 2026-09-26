import { query } from "../../database/connection.js";
import { professionalAccessQuerySchema, professionalMembershipInputSchema,
  type ProfessionalAccessQuery, type ProfessionalAccessReader, type ProfessionalAccessSnapshot,
  type ProfessionalMembershipInput } from "./professional-access.types.js";

type AccessRow = {
  account_status: "active" | "blocked";
  professional_exists: boolean;
  membership_status: "active" | "revoked" | null;
  membership_role: "owner" | "admin" | "member" | null;
  has_verified_identifier: boolean;
};

export class PostgresProfessionalAccessRepository implements ProfessionalAccessReader {
  async findSnapshot(input: ProfessionalAccessQuery): Promise<ProfessionalAccessSnapshot> {
    const { accountId, professionalId } = professionalAccessQuerySchema.parse(input);
    const result = await query<AccessRow>(`SELECT a.status AS account_status,
      EXISTS (SELECT 1 FROM professionals p WHERE p.id = $2) AS professional_exists,
      (SELECT m.status FROM professional_memberships m WHERE m.account_id = a.id AND m.professional_id = $2) AS membership_status,
      (SELECT m.role FROM professional_memberships m WHERE m.account_id = a.id AND m.professional_id = $2) AS membership_role,
      EXISTS (SELECT 1 FROM account_identifiers i WHERE i.account_id = a.id AND i.verified_at IS NOT NULL) AS has_verified_identifier
      FROM accounts a WHERE a.id = $1`, [accountId, professionalId]);
    const row = result.rows[0];
    return row ? { accountStatus: row.account_status, professionalExists: row.professional_exists,
      membershipStatus: row.membership_status, membershipRole: row.membership_role,
      hasVerifiedIdentifier: row.has_verified_identifier }
      : { accountStatus: null, professionalExists: false, membershipStatus: null,
        membershipRole: null, hasVerifiedIdentifier: false };
  }

  // Internal provisioning only; no dashboard or public route calls these methods.
  async createMembership(input: ProfessionalMembershipInput) {
    const { accountId, professionalId, role } = professionalMembershipInputSchema.parse(input);
    await query(`INSERT INTO professional_memberships(account_id, professional_id, role)
      VALUES ($1, $2, $3)`, [accountId, professionalId, role]);
  }

  async revokeMembership(input: ProfessionalAccessQuery) {
    const { accountId, professionalId } = professionalAccessQuerySchema.parse(input);
    const result = await query(`UPDATE professional_memberships SET status = 'revoked'
      WHERE account_id = $1 AND professional_id = $2 AND status = 'active'`, [accountId, professionalId]);
    return (result.rowCount ?? 0) === 1;
  }
}
