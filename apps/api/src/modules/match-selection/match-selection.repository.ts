import type { QueryResultRow } from "pg";
import { query, withTransaction, type DatabaseClient, type SqlValue } from "../../database/connection.js";
import type {
  SelectionMatchRecord,
  SelectionMatchRepository,
  SelectionMatchState,
  SelectShownMatchInput,
  SelectShownMatchOutcome,
  SelectedMatchOutcome,
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
  available_match_count: number | string;
  pending_reservation_count: number | string;
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
type ExistingSelectionRow = {
  contact_id: string;
  customer_id: string | null;
  search_request_id: string;
  match_id: string | null;
  professional_id: string;
  display_name: string | null;
  phone_e164: string | null;
  service_name: string | null;
  selected_at: Date | null;
};

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

function existingSelectionOutcome(row: ExistingSelectionRow, input: SelectShownMatchInput): SelectShownMatchOutcome {
  if (
    row.customer_id !== input.customerId
    || row.search_request_id !== input.searchRequestId
    || !row.match_id
    || !row.display_name
    || !row.phone_e164
    || !row.service_name
    || !row.selected_at
  ) return { kind: "idempotency_conflict" };
  return {
    kind: "selected",
    contactId: row.contact_id,
    matchId: row.match_id,
    professionalId: row.professional_id,
    professionalDisplayName: row.display_name,
    professionalPhoneE164: row.phone_e164,
    serviceName: row.service_name,
    selectedAt: row.selected_at,
    replayed: true,
  };
}

function replayedSelectionOutcome(row: ExistingSelectionRow): SelectedMatchOutcome | null {
  if (!row.match_id || !row.display_name || !row.phone_e164 || !row.service_name || !row.selected_at) return null;
  return {
    kind: "selected",
    contactId: row.contact_id,
    matchId: row.match_id,
    professionalId: row.professional_id,
    professionalDisplayName: row.display_name,
    professionalPhoneE164: row.phone_e164,
    serviceName: row.service_name,
    selectedAt: row.selected_at,
    replayed: true,
  };
}

async function findSelectionByKey(client: DatabaseClient, selectionKey: string) {
  const result = await client.query<ExistingSelectionRow>(
    `SELECT contacts.id AS contact_id,
            contacts.customer_id,
            contacts.search_request_id,
            matches.id AS match_id,
            contacts.professional_id,
            professionals.display_name,
            professionals.phone_e164,
            services.name AS service_name,
            matches.selected_at
       FROM contacts
       LEFT JOIN matches
         ON matches.search_request_id = contacts.search_request_id
        AND matches.professional_id = contacts.professional_id
        AND matches.selected_at IS NOT NULL
       LEFT JOIN professionals ON professionals.id = contacts.professional_id
       LEFT JOIN search_requests ON search_requests.id = contacts.search_request_id
       LEFT JOIN services ON services.id = search_requests.service_id
      WHERE contacts.selection_key = $1
      FOR UPDATE OF contacts`,
    [selectionKey],
  );
  return result.rows[0] ?? null;
}

function isSelectionKeyUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "23505"
    && "constraint" in error
    && (error as { constraint?: unknown }).constraint === "contacts_selection_key_unique_idx";
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
              )::integer AS shown_match_count,
              COUNT(*) FILTER (
                WHERE rank_position IS NOT NULL AND shown_at IS NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM channel_outbound_message_matches reservations
                     WHERE reservations.match_id = matches.id
                  )
              )::integer AS available_match_count,
              COUNT(*) FILTER (
                WHERE rank_position IS NOT NULL AND shown_at IS NULL
                  AND EXISTS (
                    SELECT 1
                      FROM channel_outbound_message_matches reservations
                      JOIN channel_outbound_messages outbound
                        ON outbound.id = reservations.channel_outbound_message_id
                     WHERE reservations.match_id = matches.id
                       AND outbound.status IN ('pending', 'processing', 'failed')
                  )
              )::integer AS pending_reservation_count
         FROM matches
        WHERE search_request_id = $1`,
      [searchRequestId],
    );
    const row = result.rows[0];
    const totalMatchCount = Number(row?.total_match_count ?? 0);
    const shownMatchCount = Number(row?.shown_match_count ?? 0);
    const availableMatchCount = row?.available_match_count === undefined
      ? totalMatchCount - shownMatchCount
      : Number(row.available_match_count);
    return {
      totalMatchCount,
      shownMatchCount,
      hasMore: availableMatchCount > 0 || Number(row?.pending_reservation_count ?? 0) > 0,
      ...(Number(row?.pending_reservation_count ?? 0) > 0 ? { hasPendingReservations: true } : {}),
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
          AND NOT EXISTS (
            SELECT 1 FROM channel_outbound_message_matches reservations
             WHERE reservations.match_id = matches.id
          )
        ORDER BY matches.rank_position ASC
        LIMIT $2`,
      [searchRequestId, limit],
    );
    return result.rows.map(toSelectionMatchRecord);
  }

  async listShown(searchRequestId: string) {
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
          AND matches.shown_at IS NOT NULL
          AND matches.rank_position IS NOT NULL
        ORDER BY matches.rank_position ASC`,
      [searchRequestId],
    );
    return result.rows.map(toSelectionMatchRecord);
  }

  async findSelectedByCustomerAndSelectionKey(customerId: string, selectionKey: string) {
    const result = await this.execute<ExistingSelectionRow>(
      `SELECT contacts.id AS contact_id,
              contacts.customer_id,
              contacts.search_request_id,
              matches.id AS match_id,
              contacts.professional_id,
              professionals.display_name,
              professionals.phone_e164,
              services.name AS service_name,
              matches.selected_at
         FROM contacts
         JOIN matches
           ON matches.search_request_id = contacts.search_request_id
          AND matches.professional_id = contacts.professional_id
          AND matches.selected_at IS NOT NULL
         JOIN professionals ON professionals.id = contacts.professional_id
         JOIN search_requests ON search_requests.id = contacts.search_request_id
         JOIN services ON services.id = search_requests.service_id
        WHERE contacts.customer_id = $1
          AND contacts.selection_key = $2`,
      [customerId, selectionKey],
    );
    return result.rows[0] ? replayedSelectionOutcome(result.rows[0]) : null;
  }

  async selectShownMatch(input: SelectShownMatchInput): Promise<SelectShownMatchOutcome> {
    try {
      return await this.transaction(async (client) => {
      const existing = await findSelectionByKey(client, input.selectionKey);
      if (existing) {
        const context = await client.query<{ id: string }>(
          `SELECT id FROM search_conversations
            WHERE id = $1 AND customer_id = $2 AND search_request_id = $3
            FOR UPDATE`,
          [input.conversationId, input.customerId, input.searchRequestId],
        );
        if (!context.rows[0]) return { kind: "idempotency_conflict" };
        return existingSelectionOutcome(existing, input);
      }

      const conversation = await client.query<SelectionConversationRow>(
        `SELECT customer_id, status, pending_slot, search_request_id, expires_at > NOW() AS is_current
           FROM search_conversations
          WHERE id = $1
          FOR UPDATE`,
        [input.conversationId],
      );
      const conversationRow = conversation.rows[0];
      if (!conversationRow) return { kind: "conversation_not_found" };

      const replayAfterLock = await findSelectionByKey(client, input.selectionKey);
      if (replayAfterLock) return existingSelectionOutcome(replayAfterLock, input);
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
        `INSERT INTO contacts (search_request_id, customer_id, professional_id, status, selection_key)
         VALUES ($1, $2, $3, 'requested', $4)
         RETURNING id`,
        [input.searchRequestId, input.customerId, matchRow.professional_id, input.selectionKey],
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
        replayed: false,
      };
      });
    } catch (error) {
      if (!isSelectionKeyUniqueViolation(error)) throw error;
      return this.transaction(async (client) => {
        const existing = await findSelectionByKey(client, input.selectionKey);
        if (!existing) throw error;
        const context = await client.query<{ id: string }>(
          `SELECT id FROM search_conversations
            WHERE id = $1 AND customer_id = $2 AND search_request_id = $3
            FOR UPDATE`,
          [input.conversationId, input.customerId, input.searchRequestId],
        );
        if (!context.rows[0]) return { kind: "idempotency_conflict" };
        return existingSelectionOutcome(existing, input);
      });
    }
  }
}
