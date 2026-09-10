import type { MatchingSearchInput, MatchingSearchResponse } from "@contatocerto/shared";
import { withTransaction } from "../../database/connection.js";
import { CANDIDATE_POOL_SIZE, presentationPageSize } from "./matching-policy.js";
import { RANKING_POLICY, rankingCtes, rankingOrder } from "./matching-ranking.js";
import { MATCHING_AVAILABILITY_FRESHNESS_MINUTES, type MatchingRepository, type MatchingSearchOutcome, type SearchExecutionContext } from "./matching.types.js";

type ServiceRow = { id: string; name: string; slug: string; is_active: boolean };
type SearchRequestRow = { id: string };
type CandidateRow = {
  professional_id: string; display_name: string; professional_slug: string; bio: string | null; profile_image_url: string | null;
  is_verified: boolean; professional_service_id: string; description: string | null; price_mode: "quote" | "fixed" | "from" | "range";
  price_from_cents: number | null; price_to_cents: number | null; service_area_id: string; service_area_label: string | null;
  service_area_city: string; service_area_state: string; radius_meters: number; distance_meters: number | string; effective_available_now: boolean;
  distance_band: number; recent_exposures: number; customer_repeats: number; recent_contacts: number;
  review_count: number; bayesian_reputation: number | string; reputation_band: number; exposure_load: number | string;
};
type MatchRow = { id: string; professional_id: string };

function responseFor(input: MatchingSearchInput, service: ServiceRow, searchRequestId: string, candidates: CandidateRow[], matchIds: string[]): MatchingSearchResponse {
  const matches = candidates.map((candidate, index) => ({
    match_id: matchIds[index], rank_position: index + 1, distance_meters: Number(candidate.distance_meters), effective_available_now: candidate.effective_available_now,
    professional: { id: candidate.professional_id, display_name: candidate.display_name, slug: candidate.professional_slug, bio: candidate.bio, profile_image_url: candidate.profile_image_url, is_verified: candidate.is_verified },
    service: { professional_service_id: candidate.professional_service_id, description: candidate.description, price_mode: candidate.price_mode, price_from_cents: candidate.price_from_cents, price_to_cents: candidate.price_to_cents },
    service_area: { id: candidate.service_area_id, label: candidate.service_area_label, city: candidate.service_area_city, state: candidate.service_area_state, radius_meters: candidate.radius_meters },
  }));
  return {
    search_request_id: searchRequestId, status: matches.length ? "matched" : "ready", service: { id: service.id, name: service.name, slug: service.slug },
    location: { latitude: input.latitude, longitude: input.longitude, city: input.city ?? null, state: input.state ?? null, neighborhood: input.neighborhood ?? null },
    matches, meta: { count: matches.length, limit: presentationPageSize(input.limit), availability_freshness_minutes: MATCHING_AVAILABILITY_FRESHNESS_MINUTES },
  };
}

export class PostgresMatchingRepository implements MatchingRepository {
  constructor(private readonly transaction: typeof withTransaction = withTransaction) {}
  async search(input: MatchingSearchInput, context: SearchExecutionContext = {}): Promise<MatchingSearchOutcome> {
    return this.transaction(async (client) => {
      const serviceResult = await client.query<ServiceRow>("SELECT id, name, slug, is_active FROM services WHERE id = $1", [input.service_id]);
      const service = serviceResult.rows[0];
      if (!service) return { kind: "service_not_found" };
      if (!service.is_active) return { kind: "service_inactive" };

      const requestResult = await client.query<SearchRequestRow>(
        `INSERT INTO search_requests (customer_id, raw_text, service_id, location, city, state, neighborhood, status)
         VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, $6, $7, $8, 'ready') RETURNING id`,
        [context.customerId ?? null, input.raw_text, input.service_id, input.latitude, input.longitude, input.city ?? null, input.state ?? null, input.neighborhood ?? null],
      );
      const searchRequestId = requestResult.rows[0].id;
      const candidatesResult = await client.query<CandidateRow>(
        `WITH requested_location AS (
           SELECT ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography AS point
         ), candidate_areas AS (
           SELECT professionals.id AS professional_id, professionals.display_name, professionals.slug AS professional_slug,
             professionals.bio, professionals.profile_image_url, professionals.is_verified,
             professional_services.id AS professional_service_id, professional_services.description,
             professional_services.price_mode, professional_services.price_from_cents, professional_services.price_to_cents,
             professional_service_areas.id AS service_area_id, professional_service_areas.label AS service_area_label,
             professional_service_areas.city AS service_area_city, professional_service_areas.state AS service_area_state,
             professional_service_areas.radius_meters,
             ROUND(ST_Distance(professional_service_areas.center, requested_location.point))::integer AS distance_meters,
             COALESCE(professionals.is_available_now = TRUE AND professionals.available_now_updated_at >= NOW() - ($4 * INTERVAL '1 minute'), FALSE) AS effective_available_now,
             ROW_NUMBER() OVER (PARTITION BY professionals.id ORDER BY ST_Distance(professional_service_areas.center, requested_location.point) ASC, professional_service_areas.id ASC) AS area_position
           FROM professionals
           JOIN professional_services ON professional_services.professional_id = professionals.id
           JOIN services ON services.id = professional_services.service_id
           JOIN professional_service_areas ON professional_service_areas.professional_id = professionals.id
           CROSS JOIN requested_location
           WHERE professionals.status = 'active'
             AND length(trim(professionals.display_name)) >= 2
             AND professionals.phone_e164 ~ '^[+][1-9][0-9]{7,14}$'
             AND length(trim(professionals.slug)) > 0
             AND professional_services.service_id = $3
             AND professional_services.is_active = TRUE
             AND services.is_active = TRUE
             AND ST_DWithin(professional_service_areas.center, requested_location.point, professional_service_areas.radius_meters)
         ), ${rankingCtes}
         SELECT * FROM ranked
         ORDER BY ${rankingOrder}
         LIMIT $5`,
        [input.latitude, input.longitude, input.service_id, MATCHING_AVAILABILITY_FRESHNESS_MINUTES, CANDIDATE_POOL_SIZE, context.customerId ?? null],
      );
      const candidates = candidatesResult.rows;
      let matchIds: string[] = [];
      if (candidates.length) {
        const records = candidates.map((candidate, index) => ({
          professional_id: candidate.professional_id,
          rank_position: index + 1,
          score_breakdown: {
            policy: RANKING_POLICY,
            effective_available_now: candidate.effective_available_now,
            distance_meters: Number(candidate.distance_meters),
            is_verified: candidate.is_verified,
            distance_band: candidate.distance_band,
            review_count: candidate.review_count,
            bayesian_reputation: Number(candidate.bayesian_reputation),
            reputation_band: candidate.reputation_band,
            recent_exposures: candidate.recent_exposures,
            recent_contacts: candidate.recent_contacts,
            customer_repeats: candidate.customer_repeats,
            exposure_load: Number(candidate.exposure_load),
            newcomer: candidate.review_count === 0,
          },
        }));
        const result = await client.query<MatchRow>(
          `INSERT INTO matches (search_request_id, professional_id, rank_position, score, score_breakdown)
           SELECT $1, professional_id, rank_position, NULL, score_breakdown
           FROM jsonb_to_recordset($2::jsonb) AS entry(professional_id uuid, rank_position integer, score_breakdown jsonb)
           RETURNING id, professional_id`,
          [searchRequestId, JSON.stringify(records)],
        );
        const idsByProfessional = new Map(result.rows.map((row) => [row.professional_id, row.id]));
        matchIds = candidates.map((candidate) => {
          const id = idsByProfessional.get(candidate.professional_id);
          if (!id) throw new Error("Matching persistence returned an incomplete pool");
          return id;
        });
        await client.query("UPDATE search_requests SET status = 'matched' WHERE id = $1", [searchRequestId]);
      }
      const pageSize = presentationPageSize(input.limit);
      return { kind: "success", response: responseFor(input, service, searchRequestId, candidates.slice(0, pageSize), matchIds.slice(0, pageSize)) };
    });
  }
}
