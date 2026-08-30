import type {
  ListProfessionalsQuery,
  ProfessionalResponse,
  UpdateProfessionalInput,
} from "@contatocerto/shared";
import { query } from "../../database/connection.js";
import type { CreateProfessionalRecord, ProfessionalsRepository } from "./professionals.types.js";

type ProfessionalRow = Omit<ProfessionalResponse, "available_now_updated_at" | "created_at" | "updated_at"> & {
  available_now_updated_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type SqlValue = string | number | boolean | Date | null;

const professionalColumns = `
  id, display_name, slug, bio, phone_e164, email, profile_image_url, status,
  is_verified, is_available_now, available_now_updated_at, created_at, updated_at
`;

function toProfessionalResponse(row: ProfessionalRow): ProfessionalResponse {
  return {
    ...row,
    available_now_updated_at: row.available_now_updated_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export class PostgresProfessionalsRepository implements ProfessionalsRepository {
  async create(input: CreateProfessionalRecord) {
    const result = await query<ProfessionalRow>(
      `INSERT INTO professionals (display_name, slug, phone_e164, email, bio, profile_image_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${professionalColumns}`,
      [
        input.display_name,
        input.slug,
        input.phone_e164,
        input.email ?? null,
        input.bio ?? null,
        input.profile_image_url ?? null,
      ],
    );

    return toProfessionalResponse(result.rows[0]);
  }

  async findById(id: string) {
    const result = await query<ProfessionalRow>(
      `SELECT ${professionalColumns} FROM professionals WHERE id = $1`,
      [id],
    );

    return result.rows[0] ? toProfessionalResponse(result.rows[0]) : null;
  }

  async list(filters: ListProfessionalsQuery) {
    const clauses: string[] = [];
    const values: SqlValue[] = [];

    if (filters.status) {
      values.push(filters.status);
      clauses.push(`status = $${values.length}`);
    }

    if (filters.q) {
      values.push(`%${filters.q}%`);
      const parameter = `$${values.length}`;
      clauses.push(`(display_name ILIKE ${parameter} OR email ILIKE ${parameter} OR phone_e164 ILIKE ${parameter} OR slug ILIKE ${parameter})`);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const countResult = await query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM professionals ${where}`,
      values,
    );

    values.push(filters.limit, filters.offset);
    const itemsResult = await query<ProfessionalRow>(
      `SELECT ${professionalColumns}
       FROM professionals
       ${where}
       ORDER BY created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    return {
      items: itemsResult.rows.map(toProfessionalResponse),
      total: countResult.rows[0].total,
    };
  }

  async update(id: string, input: UpdateProfessionalInput) {
    const columns: Array<keyof UpdateProfessionalInput> = [
      "display_name",
      "phone_e164",
      "email",
      "bio",
      "profile_image_url",
      "status",
    ];
    const values: SqlValue[] = [];
    const assignments: string[] = [];

    for (const column of columns) {
      if (input[column] !== undefined) {
        values.push(input[column] ?? null);
        assignments.push(`${column} = $${values.length}`);
      }
    }

    if (input.status !== undefined && input.status !== "active") {
      assignments.push("is_available_now = CASE WHEN is_available_now THEN FALSE ELSE is_available_now END");
      assignments.push("available_now_updated_at = CASE WHEN is_available_now THEN NOW() ELSE available_now_updated_at END");
    }

    values.push(id);
    const result = await query<ProfessionalRow>(
      `UPDATE professionals
       SET ${assignments.join(", ")}
       WHERE id = $${values.length}
       RETURNING ${professionalColumns}`,
      values,
    );

    return result.rows[0] ? toProfessionalResponse(result.rows[0]) : null;
  }

  async updateAvailability(id: string, isAvailableNow: boolean) {
    type AvailabilityRow = {
      professional_id: string | null;
      is_available_now: boolean | null;
      available_now_updated_at: Date | null;
      outcome: "updated" | "not_active";
    };
    const result = await query<AvailabilityRow>(
      `WITH existing AS (
         SELECT id, status FROM professionals WHERE id = $1
       ), updated AS (
         UPDATE professionals
         SET is_available_now = $2, available_now_updated_at = NOW()
         WHERE id = (SELECT id FROM existing)
           AND ($2 = FALSE OR status = 'active')
         RETURNING id, is_available_now, available_now_updated_at
       )
       SELECT id AS professional_id, is_available_now, available_now_updated_at, 'updated'::text AS outcome
       FROM updated
       UNION ALL
       SELECT NULL, NULL, NULL, 'not_active'::text AS outcome
       FROM existing
       WHERE NOT EXISTS (SELECT 1 FROM updated)`,
      [id, isAvailableNow],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.outcome === "not_active") return "not_active";

    return {
      professional_id: row.professional_id!,
      is_available_now: row.is_available_now!,
      available_now_updated_at: row.available_now_updated_at!.toISOString(),
    };
  }
}
