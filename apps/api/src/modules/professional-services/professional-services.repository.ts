import type { CreateProfessionalServiceInput, ProfessionalServiceResponse } from "@contatocerto/shared";
import { query } from "../../database/connection.js";
import type {
  ProfessionalServicesRepository,
  ProfessionalServiceUpdateRecord,
} from "./professional-services.types.js";

type ProfessionalServiceRow = Omit<ProfessionalServiceResponse, "service" | "created_at" | "updated_at"> & {
  service_name: string;
  service_slug: string;
  category_id: string;
  category_name: string;
  category_slug: string;
  created_at: Date;
  updated_at: Date;
};

const columns = `
  professional_services.id, professional_services.professional_id, professional_services.service_id,
  professional_services.description, professional_services.price_mode, professional_services.price_from_cents,
  professional_services.price_to_cents, professional_services.is_active, professional_services.created_at,
  professional_services.updated_at, services.name AS service_name, services.slug AS service_slug,
  service_categories.id AS category_id, service_categories.name AS category_name,
  service_categories.slug AS category_slug
`;

const joins = `
  FROM professional_services
  JOIN services ON services.id = professional_services.service_id
  JOIN service_categories ON service_categories.id = services.category_id
`;

function toProfessionalServiceResponse(row: ProfessionalServiceRow): ProfessionalServiceResponse {
  return {
    id: row.id,
    professional_id: row.professional_id,
    service_id: row.service_id,
    description: row.description,
    price_mode: row.price_mode,
    price_from_cents: row.price_from_cents,
    price_to_cents: row.price_to_cents,
    is_active: row.is_active,
    service: {
      id: row.service_id,
      name: row.service_name,
      slug: row.service_slug,
      category: { id: row.category_id, name: row.category_name, slug: row.category_slug },
    },
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export class PostgresProfessionalServicesRepository implements ProfessionalServicesRepository {
  async professionalExists(professionalId: string) {
    const result = await query<{ exists: boolean }>("SELECT EXISTS(SELECT 1 FROM professionals WHERE id = $1) AS exists", [professionalId]);
    return result.rows[0].exists;
  }

  async findService(serviceId: string) {
    const result = await query<{ id: string; is_active: boolean }>(
      "SELECT id, is_active FROM services WHERE id = $1",
      [serviceId],
    );
    return result.rows[0] ?? null;
  }

  async findByProfessionalAndService(professionalId: string, serviceId: string) {
    const result = await query<ProfessionalServiceRow>(
      `SELECT ${columns} ${joins} WHERE professional_services.professional_id = $1 AND professional_services.service_id = $2`,
      [professionalId, serviceId],
    );
    return result.rows[0] ? toProfessionalServiceResponse(result.rows[0]) : null;
  }

  async findById(professionalId: string, professionalServiceId: string) {
    const result = await query<ProfessionalServiceRow>(
      `SELECT ${columns} ${joins} WHERE professional_services.professional_id = $1 AND professional_services.id = $2`,
      [professionalId, professionalServiceId],
    );
    return result.rows[0] ? toProfessionalServiceResponse(result.rows[0]) : null;
  }

  async listByProfessional(professionalId: string) {
    const result = await query<ProfessionalServiceRow>(
      `SELECT ${columns} ${joins} WHERE professional_services.professional_id = $1 ORDER BY services.name ASC`,
      [professionalId],
    );
    return result.rows.map(toProfessionalServiceResponse);
  }

  async create(professionalId: string, input: CreateProfessionalServiceInput) {
    const result = await query<ProfessionalServiceRow>(
      `WITH inserted AS (
         INSERT INTO professional_services
           (professional_id, service_id, description, price_mode, price_from_cents, price_to_cents)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *
       )
       SELECT ${columns.replaceAll("professional_services.", "inserted.")}
       FROM inserted
       JOIN services ON services.id = inserted.service_id
       JOIN service_categories ON service_categories.id = services.category_id`,
      [
        professionalId,
        input.service_id,
        input.description ?? null,
        input.price_mode,
        input.price_from_cents ?? null,
        input.price_to_cents ?? null,
      ],
    );
    return toProfessionalServiceResponse(result.rows[0]);
  }

  async update(professionalId: string, professionalServiceId: string, input: ProfessionalServiceUpdateRecord) {
    const result = await query<ProfessionalServiceRow>(
      `WITH updated AS (
         UPDATE professional_services
         SET description = $3, price_mode = $4, price_from_cents = $5, price_to_cents = $6, is_active = $7
         WHERE professional_id = $1 AND id = $2
         RETURNING *
       )
       SELECT ${columns.replaceAll("professional_services.", "updated.")}
       FROM updated
       JOIN services ON services.id = updated.service_id
       JOIN service_categories ON service_categories.id = services.category_id`,
      [professionalId, professionalServiceId, input.description, input.price_mode, input.price_from_cents, input.price_to_cents, input.is_active],
    );
    return result.rows[0] ? toProfessionalServiceResponse(result.rows[0]) : null;
  }
}
