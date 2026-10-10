import type { QueryResultRow } from "pg";
import { query, type SqlValue } from "../../database/connection.js";

export type CustomerLastLocationSource = "whatsapp_native" | "text_resolved" | "memory_reuse";

export type CustomerLastLocation = {
  customerId: string;
  latitude: number;
  longitude: number;
  city: string | null;
  state: string | null;
  countryCode: string;
  label: string;
  source: CustomerLastLocationSource;
  confirmedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type CustomerLastLocationInput = {
  customerId: string;
  latitude: number;
  longitude: number;
  city?: string | null;
  state?: string | null;
  countryCode?: string;
  label: string;
  source: CustomerLastLocationSource;
  confirmedAt?: Date;
};

type Row = {
  customer_id: string;
  latitude: number;
  longitude: number;
  city: string | null;
  state: string | null;
  country_code: string;
  label: string;
  source: CustomerLastLocationSource;
  confirmed_at: Date;
  created_at: Date;
  updated_at: Date;
};

function toRecord(row: Row): CustomerLastLocation {
  return {
    customerId: row.customer_id,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    city: row.city,
    state: row.state,
    countryCode: row.country_code,
    label: row.label,
    source: row.source,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CustomerLastLocationRepository {
  findByCustomerId(customerId: string): Promise<CustomerLastLocation | null>;
  upsert(input: CustomerLastLocationInput): Promise<CustomerLastLocation>;
}

export class PostgresCustomerLastLocationRepository implements CustomerLastLocationRepository {
  constructor(
    private readonly execute: <T extends QueryResultRow>(text: string, values?: SqlValue[]) => Promise<{ rows: T[] }> = (text, values = []) => query(text, values),
  ) {}

  async findByCustomerId(customerId: string): Promise<CustomerLastLocation | null> {
    const result = await this.execute<Row>(
      `SELECT customer_id, latitude, longitude, city, state, country_code, label, source, confirmed_at, created_at, updated_at
         FROM customer_last_locations
        WHERE customer_id = $1`,
      [customerId],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async upsert(input: CustomerLastLocationInput): Promise<CustomerLastLocation> {
    const confirmedAt = input.confirmedAt ?? new Date();
    const result = await this.execute<Row>(
      `INSERT INTO customer_last_locations (
         customer_id, latitude, longitude, city, state, country_code, label, source, confirmed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (customer_id) DO UPDATE SET
         latitude = EXCLUDED.latitude,
         longitude = EXCLUDED.longitude,
         city = EXCLUDED.city,
         state = EXCLUDED.state,
         country_code = EXCLUDED.country_code,
         label = EXCLUDED.label,
         source = EXCLUDED.source,
         confirmed_at = EXCLUDED.confirmed_at,
         updated_at = NOW()
       RETURNING customer_id, latitude, longitude, city, state, country_code, label, source, confirmed_at, created_at, updated_at`,
      [
        input.customerId,
        input.latitude,
        input.longitude,
        input.city ?? null,
        input.state ?? null,
        input.countryCode ?? "BR",
        input.label,
        input.source,
        confirmedAt,
      ],
    );
    return toRecord(result.rows[0]!);
  }
}
