import { query } from "../../database/connection.js";
import { normalizeAccountIdentifier, type AccountIdentifierInput } from "./account-identity.types.js";

export class PostgresAccountIdentityRepository {
  async createAccount() {
    const result = await query<{ id: string }>("INSERT INTO accounts DEFAULT VALUES RETURNING id");
    return { id: result.rows[0]!.id };
  }

  async addIdentifier(input: AccountIdentifierInput) {
    const { accountId, kind, normalizedValue } = normalizeAccountIdentifier(input);
    const result = await query<{ id: string }>(`INSERT INTO account_identifiers(account_id, kind, normalized_value)
      VALUES ($1, $2, $3) RETURNING id`, [accountId, kind, normalizedValue]);
    // Creation never implies proof. Only a later verification flow may set verified_at.
    return { id: result.rows[0]!.id };
  }
}
