import {
  normalizeBrazilianMobilePhone,
  getPhoneIdentityAliases,
} from "@contatocerto/shared";
import type { QueryResultRow } from "pg";
import { query, type SqlValue } from "../../database/connection.js";

type CustomerRow = { id: string; phone_e164: string };

export type Customer = { id: string };
export type CustomerQuery = <T extends QueryResultRow>(
  text: string,
  values?: SqlValue[],
) => Promise<{ rows: T[] }>;

export interface CustomerRepository {
  findOrCreateByPhoneE164(phoneE164: string): Promise<Customer>;
}

export class PostgresCustomerRepository implements CustomerRepository {
  constructor(private readonly execute: CustomerQuery = query) {}

  async findOrCreateByPhoneE164(phoneE164: string): Promise<Customer> {
    const canonicalPhone = normalizeBrazilianMobilePhone(phoneE164);
    const aliases = getPhoneIdentityAliases(canonicalPhone);

    const existing = await this.execute<CustomerRow>(
      `SELECT id, phone_e164 FROM customers WHERE phone_e164 = ANY($1) FOR UPDATE`,
      [aliases as string[]],
    );

    if (existing.rows.length > 1) {
      throw new Error("CUSTOMER_PHONE_IDENTITY_COLLISION");
    }

    if (existing.rows.length === 1) {
      const row = existing.rows[0]!;
      if (row.phone_e164 !== canonicalPhone) {
        await this.execute(
          `UPDATE customers SET phone_e164 = $1 WHERE id = $2`,
          [canonicalPhone, row.id],
        );
      }
      return { id: row.id };
    }

    const result = await this.execute<{ id: string }>(
      `INSERT INTO customers (phone_e164)
       VALUES ($1)
       ON CONFLICT (phone_e164) DO UPDATE SET phone_e164 = EXCLUDED.phone_e164
       RETURNING id`,
      [canonicalPhone],
    );
    return { id: result.rows[0]!.id };
  }
}
