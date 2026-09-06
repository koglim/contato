import type { QueryResultRow } from "pg";
import { query, type SqlValue } from "../../database/connection.js";
import type {
  SelectionMatchRecord,
  SelectionMatchRepository,
  SelectionMatchState,
} from "./match-selection.types.js";

type SelectionMatchRow = {
  match_id: string;
  search_request_id: string;
  professional_id: string;
  rank_position: number | null;
  shown_at: Date | null;
  selected_at: Date | null;
  display_name: string;
  phone_e164: string;
  slug: string;
  profile_image_url: string | null;
  is_verified: boolean;
  service_name: string;
  service_description: string | null;
  price_mode: SelectionMatchRecord["priceMode"];
  price_from_cents: number | null;
  price_to_cents: number | null;
  distance_meters: number | null;
  effective_available_now: boolean | null;
};

type SelectionMatchStateRow = {
  total_match_count: number | string;
  shown_match_count: number | string;
};

export type SelectionMatchQuery = <T extends QueryResultRow>(
  text: string,
  values?: SqlValue[],
) => Promise<{ rows: T[] }>;

const selectionMatchColumns = `
  matches.id AS match_id,
  matches.search_request_id,
  matches.professional_id,
  matches.rank_position,
  matches.shown_at,
  matches.selected_at,
  professionals.display_name,
  professionals.phone_e164,
  professionals.slug,
  professionals.profile_image_url,
  professionals.is_verified,
  services.name AS service_name,
  professional_services.description AS service_description,
  professional_services.price_mode,
  professional_services.price_from_cents,
  professional_services.price_to_cents,
  (matches.score_breakdown ->> 'distance_meters')::integer AS distance_meters,
  (matches.score_breakdown ->> 'effective_available_now')::boolean AS effective_available_now
`;

function toSelectionMatchRecord(row: SelectionMatchRow): SelectionMatchRecord {
  return {
    matchId: row.match_id,
    searchRequestId: row.search_request_id,
    professionalId: row.professional_id,
    rankPosition: row.rank_position,
    shownAt: row.shown_at,
    selectedAt: row.selected_at,
    displayName: row.display_name,
    phoneE164: row.phone_e164,
    slug: row.slug,
    profileImageUrl: row.profile_image_url,
    isVerified: row.is_verified,
    serviceName: row.service_name,
    serviceDescription: row.service_description,
    priceMode: row.price_mode,
    priceFromCents: row.price_from_cents,
    priceToCents: row.price_to_cents,
    distanceMeters: row.distance_meters,
    effectiveAvailableNow: row.effective_available_now,
  };
}

export class PostgresSelectionMatchRepository implements SelectionMatchRepository {
  constructor(private readonly execute: SelectionMatchQuery = query) {}

  async getState(searchRequestId: string): Promise<SelectionMatchState> {
    const result = await this.execute<SelectionMatchStateRow>(
      `SELECT COUNT(*) FILTER (WHERE rank_position IS NOT NULL)::integer AS total_match_count,
              COUNT(*) FILTER (
                WHERE rank_position IS NOT NULL AND shown_at IS NOT NULL
              )::integer AS shown_match_count
         FROM matches
        WHERE search_request_id = $1`,
      [searchRequestId],
    );
    const row = result.rows[0];
    const totalMatchCount = Number(row?.total_match_count ?? 0);
    const shownMatchCount = Number(row?.shown_match_count ?? 0);
    return {
      totalMatchCount,
      shownMatchCount,
      hasMore: totalMatchCount > shownMatchCount,
    };
  }

  async findShownByPosition(searchRequestId: string, position: number) {
    const result = await this.execute<SelectionMatchRow>(
      `SELECT ${selectionMatchColumns}
         FROM matches
         JOIN search_requests ON search_requests.id = matches.search_request_id
         JOIN professionals ON professionals.id = matches.professional_id
         JOIN services ON services.id = search_requests.service_id
         JOIN professional_services
           ON professional_services.professional_id = matches.professional_id
          AND professional_services.service_id = search_requests.service_id
        WHERE matches.search_request_id = $1
          AND matches.rank_position = $2
          AND matches.shown_at IS NOT NULL`,
      [searchRequestId, position],
    );
    return result.rows[0] ? toSelectionMatchRecord(result.rows[0]) : null;
  }

  async listNextUnshown(searchRequestId: string, limit: number) {
    const result = await this.execute<SelectionMatchRow>(
      `SELECT ${selectionMatchColumns}
         FROM matches
         JOIN search_requests ON search_requests.id = matches.search_request_id
         JOIN professionals ON professionals.id = matches.professional_id
         JOIN services ON services.id = search_requests.service_id
         JOIN professional_services
           ON professional_services.professional_id = matches.professional_id
          AND professional_services.service_id = search_requests.service_id
        WHERE matches.search_request_id = $1
          AND matches.shown_at IS NULL
          AND matches.rank_position IS NOT NULL
        ORDER BY matches.rank_position ASC
        LIMIT $2`,
      [searchRequestId, limit],
    );
    return result.rows.map(toSelectionMatchRecord);
  }
}
