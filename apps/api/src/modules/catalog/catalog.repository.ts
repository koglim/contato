import type { ServiceCatalogItem } from "@contatocerto/shared";
import { query } from "../../database/connection.js";
import type { CatalogRepository } from "./catalog.types.js";

type CatalogServiceRow = Omit<ServiceCatalogItem, "category"> & {
  category_id: string;
  category_name: string;
  category_slug: string;
};

function toCatalogItem(row: CatalogServiceRow): ServiceCatalogItem {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    is_active: row.is_active,
    category: { id: row.category_id, name: row.category_name, slug: row.category_slug },
  };
}

export class PostgresCatalogRepository implements CatalogRepository {
  async listServices(filters: { q?: string; category_id?: string }) {
    const values: string[] = [];
    const clauses = ["services.is_active = TRUE"];

    if (filters.q) {
      values.push(`%${filters.q}%`);
      clauses.push(`(services.name ILIKE $${values.length} OR services.slug ILIKE $${values.length})`);
    }

    if (filters.category_id) {
      values.push(filters.category_id);
      clauses.push(`services.category_id = $${values.length}`);
    }

    const result = await query<CatalogServiceRow>(
      `SELECT services.id, services.name, services.slug, services.description, services.is_active,
              service_categories.id AS category_id, service_categories.name AS category_name,
              service_categories.slug AS category_slug
       FROM services
       JOIN service_categories ON service_categories.id = services.category_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY service_categories.name ASC, services.name ASC`,
      values,
    );

    return result.rows.map(toCatalogItem);
  }
}
