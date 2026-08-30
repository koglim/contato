import type { CreateServiceAreaInput, ServiceAreaResponse } from "@contatocerto/shared";
import { query, withTransaction, type DatabaseClient } from "../../database/connection.js";
import type { ServiceAreasRepository, ServiceAreaUpdateRecord } from "./service-areas.types.js";

type ServiceAreaRow = Omit<ServiceAreaResponse, "created_at" | "updated_at"> & {
  latitude: number | string;
  longitude: number | string;
  created_at: Date;
  updated_at: Date;
};

const columns = `
  id, professional_id, label, city, state, country_code, neighborhood,
  ST_Y(center::geometry) AS latitude, ST_X(center::geometry) AS longitude,
  radius_meters, is_primary, created_at, updated_at
`;

function toServiceAreaResponse(row: ServiceAreaRow): ServiceAreaResponse {
  return {
    ...row,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

async function clearPrimary(client: DatabaseClient, professionalId: string) {
  await client.query(
    "UPDATE professional_service_areas SET is_primary = FALSE WHERE professional_id = $1 AND is_primary = TRUE",
    [professionalId],
  );
}

export class PostgresServiceAreasRepository implements ServiceAreasRepository {
  async professionalExists(professionalId: string) {
    const result = await query<{ exists: boolean }>("SELECT EXISTS(SELECT 1 FROM professionals WHERE id = $1) AS exists", [professionalId]);
    return result.rows[0].exists;
  }

  async listByProfessional(professionalId: string) {
    const result = await query<ServiceAreaRow>(
      `SELECT ${columns} FROM professional_service_areas WHERE professional_id = $1 ORDER BY is_primary DESC, created_at ASC`,
      [professionalId],
    );
    return result.rows.map(toServiceAreaResponse);
  }

  async findById(professionalId: string, areaId: string) {
    const result = await query<ServiceAreaRow>(
      `SELECT ${columns} FROM professional_service_areas WHERE professional_id = $1 AND id = $2`,
      [professionalId, areaId],
    );
    return result.rows[0] ? toServiceAreaResponse(result.rows[0]) : null;
  }

  async create(professionalId: string, input: CreateServiceAreaInput) {
    return withTransaction(async (client) => {
      if (input.is_primary) {
        await clearPrimary(client, professionalId);
      }
      const result = await client.query<ServiceAreaRow>(
        `INSERT INTO professional_service_areas
          (professional_id, label, city, state, country_code, neighborhood, center, radius_meters, is_primary)
         VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography, $9, $10)
         RETURNING ${columns}`,
        [
          professionalId,
          input.label ?? null,
          input.city,
          input.state,
          input.country_code,
          input.neighborhood ?? null,
          input.longitude,
          input.latitude,
          input.radius_meters,
          input.is_primary,
        ],
      );
      return toServiceAreaResponse(result.rows[0]);
    });
  }

  async update(professionalId: string, areaId: string, input: ServiceAreaUpdateRecord) {
    return withTransaction(async (client) => {
      if (input.is_primary) {
        await clearPrimary(client, professionalId);
      }
      const result = await client.query<ServiceAreaRow>(
        `UPDATE professional_service_areas
         SET label = $3, city = $4, state = $5, country_code = $6, neighborhood = $7,
             center = ST_SetSRID(ST_MakePoint($8, $9), 4326)::geography,
             radius_meters = $10, is_primary = $11
         WHERE professional_id = $1 AND id = $2
         RETURNING ${columns}`,
        [
          professionalId,
          areaId,
          input.label,
          input.city,
          input.state,
          input.country_code,
          input.neighborhood,
          input.longitude,
          input.latitude,
          input.radius_meters,
          input.is_primary,
        ],
      );
      return result.rows[0] ? toServiceAreaResponse(result.rows[0]) : null;
    });
  }

  async delete(professionalId: string, areaId: string) {
    const result = await query(
      "DELETE FROM professional_service_areas WHERE professional_id = $1 AND id = $2 RETURNING id",
      [professionalId, areaId],
    );
    return result.rowCount === 1;
  }
}
