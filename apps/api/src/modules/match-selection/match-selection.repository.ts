import type { QueryResultRow } from "pg";
import { query, withTransaction, type DatabaseClient, type SqlValue } from "../../database/connection.js";
import type {
  SelectionMatchRecord,
  SelectionMatchRepository,
  SelectionMatchState,
  SelectShownMatchInput,
  SelectShownMatchOutcome,
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
export type SelectionMatchTransaction = <T>(callback: (client: DatabaseClient) => Promise<T>) => Promise<T>;

type SelectionConversationRow = {
  customer_id: string | null;
  status: string;
  pending_slot: string | null;
  search_request_id: string | null;
  is_current: boolean;
};

type SelectionSearchRequestRow = { customer_id: string | null; status: string };

type SelectableMatchRow = {
  match_id: string;
  professional_id: string;
  display_name: string;
  phone_e164: string;
  service_name: string;
};

type SelectedMatchRow = { selected_at: Date };
type ContactRow = { id: string };

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
  constructor(
    private readonly execute: SelectionMatchQuery = query,
    private readonly transaction: SelectionMatchTransaction = withTransaction,
  ) {}

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

  async selectShownMatch(input: SelectShownMatchInput): Promise<SelectShownMatchOutcome> {
    return this.transaction(async (client) => {
      const conversation = await client.query<SelectionConversationRow>(
        `SELECT customer_id, status, pending_slot, search_request_id, expires_at > NOW() AS is_current
           FROM search_conversations
          WHERE id = $1
          FOR UPDATE`,
        [input.conversationId],
      );
      const conversationRow = conversation.rows[0];
      if (!conversationRow) return { kind: "conversation_not_found" };
      if (conversationRow.customer_id !== input.customerId) return { kind: "conversation_customer_mismatch" };
      if (
        conversationRow.status !== "active"
        || conversationRow.pending_slot !== "selection"
        || conversationRow.search_request_id !== input.searchRequestId
      ) return { kind: "conversation_not_active" };
      if (!conversationRow.is_current) return { kind: "conversation_expired" };

      const searchRequest = await client.query<SelectionSearchRequestRow>(
        `SELECT customer_id, status
           FROM search_requests
          WHERE id = $1
          FOR UPDATE`,
        [input.searchRequestId],
      );
      const searchRequestRow = searchRequest.rows[0];
      if (
        !searchRequestRow
        || searchRequestRow.customer_id !== input.customerId
        || searchRequestRow.status !== "matched"
      ) return { kind: "search_request_not_selectable" };

      const match = await client.query<SelectableMatchRow>(
        `SELECT matches.id AS match_id,
                matches.professional_id,
                professionals.display_name,
                professionals.phone_e164,
                services.name AS service_name
           FROM matches
           JOIN professionals ON professionals.id = matches.professional_id
           JOIN search_requests ON search_requests.id = matches.search_request_id
           JOIN services ON services.id = search_requests.service_id
          WHERE matches.search_request_id = $1
            AND matches.rank_position = $2
            AND matches.shown_at IS NOT NULL
            AND matches.selected_at IS NULL
          FOR UPDATE OF matches`,
        [input.searchRequestId, input.position],
      );
      const matchRow = match.rows[0];
      if (!matchRow) return { kind: "match_not_available" };

      const selected = await client.query<SelectedMatchRow>(
        `UPDATE matches
            SET selected_at = NOW()
          WHERE id = $1
            AND selected_at IS NULL
          RETURNING selected_at`,
        [matchRow.match_id],
      );
      if (!selected.rows[0]) return { kind: "match_not_available" };

      await client.query(
        `UPDATE search_requests SET status = 'selected' WHERE id = $1 AND status = 'matched'`,
        [input.searchRequestId],
      );
      const contact = await client.query<ContactRow>(
        `INSERT INTO contacts (search_request_id, customer_id, professional_id, status)
         VALUES ($1, $2, $3, 'requested')
         RETURNING id`,
        [input.searchRequestId, input.customerId, matchRow.professional_id],
      );
      await client.query(
        `UPDATE search_conversations
            SET status = 'completed',
                pending_slot = NULL,
                last_message_text = $2,
                completed_at = NOW(),
                processing_token = NULL,
                processing_started_at = NULL
          WHERE id = $1`,
        [input.conversationId, input.lastMessageText],
      );

      return {
        kind: "selected",
        contactId: contact.rows[0]!.id,
        matchId: matchRow.match_id,
        professionalId: matchRow.professional_id,
        professionalDisplayName: matchRow.display_name,
        professionalPhoneE164: matchRow.phone_e164,
        serviceName: matchRow.service_name,
        selectedAt: selected.rows[0].selected_at,
      };
    });
  }
}
