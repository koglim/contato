import {
  normalizeBrazilianMobilePhone,
  getPhoneIdentityAliases,
} from "@contatocerto/shared";
import type { QueryResultRow } from "pg";
import { withTransaction, type SqlValue, type DatabaseClient } from "../../database/connection.js";

type CustomerRow = { id: string; phone_e164: string };

export class CustomerPhoneIdentityCollisionError extends Error {
  readonly code = "customer_phone_identity_collision" as const;
  constructor(readonly phoneE164: string) {
    super(`Multiple conflicting customer records found for phone aliases of ${phoneE164}`);
    this.name = "CustomerPhoneIdentityCollisionError";
  }
}

export type Customer = { id: string };
export type CustomerQuery = <T extends QueryResultRow>(
  text: string,
  values?: SqlValue[],
) => Promise<{ rows: T[] }>;

export async function resolveCustomerByPhoneE164(
  db: { query: CustomerQuery },
  phoneE164: string,
): Promise<Customer> {
  const canonicalPhone = normalizeBrazilianMobilePhone(phoneE164);
  const aliases = getPhoneIdentityAliases(canonicalPhone);

  const existing = await db.query<CustomerRow>(
    `SELECT id, phone_e164 FROM customers WHERE phone_e164 = ANY($1) FOR UPDATE`,
    [aliases as string[]],
  );

  if (existing.rows.length > 1) {
    throw new CustomerPhoneIdentityCollisionError(phoneE164);
  }

  if (existing.rows.length === 1) {
    const row = existing.rows[0]!;
    if (row.phone_e164 !== canonicalPhone) {
      await db.query(
        `UPDATE customers SET phone_e164 = $1 WHERE id = $2`,
        [canonicalPhone, row.id],
      );
    }
    return { id: row.id };
  }

  const result = await db.query<{ id: string }>(
    `INSERT INTO customers (phone_e164)
     VALUES ($1)
     ON CONFLICT (phone_e164) DO UPDATE SET phone_e164 = EXCLUDED.phone_e164
     RETURNING id`,
    [canonicalPhone],
  );
  return { id: result.rows[0]!.id };
}

export interface CustomerRepository {
  findOrCreateByPhoneE164(phoneE164: string): Promise<Customer>;
}

export class PostgresCustomerRepository implements CustomerRepository {
  constructor(
    private readonly execute?: CustomerQuery,
    private readonly transaction: <T>(callback: (client: DatabaseClient) => Promise<T>) => Promise<T> = withTransaction,
  ) {}

  async findOrCreateByPhoneE164(phoneE164: string, db?: { query: CustomerQuery }): Promise<Customer> {
    if (db) {
      return resolveCustomerByPhoneE164(db, phoneE164);
    }
    if (this.execute) {
      return resolveCustomerByPhoneE164({ query: this.execute }, phoneE164);
    }
    return this.transaction(async (client) => resolveCustomerByPhoneE164(client, phoneE164));
  }
}

