import type { QueryResultRow } from "pg";
import { query, type SqlValue } from "../../database/connection.js";

type CustomerRow = { id: string };

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
    const result = await this.execute<CustomerRow>(
      `INSERT INTO customers (phone_e164)
       VALUES ($1)
       ON CONFLICT (phone_e164) DO UPDATE SET phone_e164 = EXCLUDED.phone_e164
       RETURNING id`,
      [phoneE164],
    );
    return { id: result.rows[0]!.id };
  }
}
