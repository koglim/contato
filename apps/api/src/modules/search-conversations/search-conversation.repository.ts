import type { QueryResultRow } from "pg";
import { query, type SqlValue } from "../../database/connection.js";
import type {
  CompleteSearchConversation,
  CreateAwaitingSelectionConversation,
  CreatePendingConversation,
  MoveToAwaitingSelectionConversation,
  SearchConversationRecord,
  SearchConversationRepository,
  SearchConversationPendingSlot,
  SearchConversationStatus,
  UpdatePendingConversation,
} from "./search-conversation.types.js";

type SearchConversationRow = {
  id: string;
  customer_id: string | null;
  status: SearchConversationStatus;
  pending_slot: SearchConversationPendingSlot | null;
  original_raw_text: string;
  service_text: string;
  location_text: string | null;
  country_code: string;
  limit_value: number;
  last_message_text: string | null;
  search_request_id: string | null;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  is_expired: boolean;
};

export type SearchConversationQuery = <T extends QueryResultRow>(
  text: string,
  values?: SqlValue[],
) => Promise<{ rows: T[] }>;

const conversationColumns = `
  id, customer_id, status, pending_slot, original_raw_text, service_text, location_text, country_code,
  limit_value, last_message_text, search_request_id, expires_at, created_at, updated_at,
  completed_at, (expires_at <= NOW()) AS is_expired
`;

function toRecord(row: SearchConversationRow): SearchConversationRecord {
  return {
    id: row.id,
    customerId: row.customer_id,
    status: row.status,
    pendingSlot: row.pending_slot,
    originalRawText: row.original_raw_text,
    serviceText: row.service_text,
    locationText: row.location_text,
    countryCode: row.country_code,
    limitValue: row.limit_value,
    lastMessageText: row.last_message_text,
    searchRequestId: row.search_request_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    isExpired: row.is_expired,
  };
}

export class PostgresSearchConversationRepository implements SearchConversationRepository {
  constructor(private readonly execute: SearchConversationQuery = query) {}

  async createPending(input: CreatePendingConversation) {
    const result = await this.execute<SearchConversationRow>(
      `WITH owner_lock AS MATERIALIZED (SELECT id FROM customers WHERE id = $1 FOR NO KEY UPDATE)
       INSERT INTO search_conversations (
         customer_id, status, pending_slot, original_raw_text, service_text, location_text, country_code,
         limit_value, last_message_text, expires_at
       ) SELECT $1, 'active', $2, $3, $4, $5, $6, $7, $3, NOW() + ($8 * INTERVAL '1 minute') FROM (SELECT count(*) FROM owner_lock) locked
       RETURNING ${conversationColumns}`,
      [
        input.customerId ?? null,
        input.pendingSlot,
        input.originalRawText,
        input.serviceText,
        input.locationText,
        input.countryCode,
        input.limitValue,
        input.ttlMinutes,
      ],
    );
    return toRecord(result.rows[0]);
  }

  async createAwaitingSelection(input: CreateAwaitingSelectionConversation) {
    const result = await this.execute<SearchConversationRow>(
      `WITH owner_lock AS MATERIALIZED (SELECT id FROM customers WHERE id = $1 FOR NO KEY UPDATE)
       INSERT INTO search_conversations (
         customer_id, status, pending_slot, original_raw_text, service_text, location_text, country_code,
         limit_value, last_message_text, search_request_id, processing_token, processing_started_at,
         completed_at, expires_at
       ) SELECT $1, 'active', 'selection', $2, $3, $4, $5, $6, $2, $7, NULL, NULL, NULL,
         NOW() + ($8 * INTERVAL '1 minute') FROM (SELECT count(*) FROM owner_lock) locked
       RETURNING ${conversationColumns}`,
      [
        input.customerId ?? null,
        input.originalRawText,
        input.serviceText,
        input.locationText,
        input.countryCode,
        input.limitValue,
        input.searchRequestId,
        input.ttlMinutes,
      ],
    );
    return toRecord(result.rows[0]);
  }

  async findById(id: string) {
    const result = await this.execute<SearchConversationRow>(
      `SELECT ${conversationColumns} FROM search_conversations WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async expireStaleForCustomer(customerId: string) {
    await this.execute(
      `UPDATE search_conversations
       SET status = 'expired', pending_slot = NULL, processing_token = NULL, processing_started_at = NULL
       WHERE customer_id = $1 AND status = 'active' AND expires_at <= NOW()`,
      [customerId],
    );
  }

  async findActiveByCustomerId(customerId: string) {
    const result = await this.execute<SearchConversationRow>(
      `SELECT ${conversationColumns} FROM search_conversations
       WHERE customer_id = $1 AND status = 'active' AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [customerId],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async findRecentExpiredWithShownMatches(customerId: string): Promise<{ id: string; searchRequestId: string } | null> {
    const result = await this.execute<{ id: string; search_request_id: string }>(
      `SELECT c.id, c.search_request_id
         FROM search_conversations c
        WHERE c.customer_id = $1
          AND (c.status = 'expired' OR (c.status = 'active' AND c.expires_at <= NOW()))
          AND c.search_request_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM matches m
             WHERE m.search_request_id = c.search_request_id
               AND m.shown_at IS NOT NULL
          )
        ORDER BY c.created_at DESC
        LIMIT 1`,
      [customerId],
    );
    return result.rows[0] ? { id: result.rows[0].id, searchRequestId: result.rows[0].search_request_id } : null;
  }

  async claim(id: string, processingToken: string, processingLeaseSeconds: number) {
    const result = await this.execute<SearchConversationRow>(
      `UPDATE search_conversations
       SET processing_token = $2, processing_started_at = NOW()
       WHERE id = $1
         AND status = 'active'
         AND pending_slot IN ('location', 'service')
         AND expires_at > NOW()
         AND (
           processing_token IS NULL
           OR processing_started_at <= NOW() - ($3 * INTERVAL '1 second')
         )
       RETURNING ${conversationColumns}`,
      [id, processingToken, processingLeaseSeconds],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async updatePending(input: UpdatePendingConversation) {
    const result = await this.execute<{ id: string }>(
      `UPDATE search_conversations
       SET pending_slot = $3,
           service_text = $4,
           location_text = $5,
           last_message_text = $6,
           expires_at = NOW() + ($7 * INTERVAL '1 minute'),
           processing_token = NULL,
           processing_started_at = NULL
       WHERE id = $1 AND status = 'active' AND processing_token = $2
       RETURNING id`,
      [
        input.id,
        input.processingToken,
        input.pendingSlot,
        input.serviceText,
        input.locationText,
        input.lastMessageText,
        input.ttlMinutes,
      ],
    );
    return result.rows.length === 1;
  }

  async moveToAwaitingSelection(input: MoveToAwaitingSelectionConversation) {
    const result = await this.execute<{ id: string }>(
      `UPDATE search_conversations
       SET pending_slot = 'selection',
           service_text = $3,
           location_text = $4,
           last_message_text = $5,
           search_request_id = $6,
           expires_at = NOW() + ($7 * INTERVAL '1 minute'),
           processing_token = NULL,
           processing_started_at = NULL,
           completed_at = NULL
       WHERE id = $1
         AND status = 'active'
         AND processing_token = $2
         AND pending_slot IN ('location', 'service')
       RETURNING id`,
      [
        input.id,
        input.processingToken,
        input.serviceText,
        input.locationText,
        input.lastMessageText,
        input.searchRequestId,
        input.ttlMinutes,
      ],
    );
    return result.rows.length === 1;
  }

  async complete(input: CompleteSearchConversation) {
    const result = await this.execute<{ id: string }>(
      `UPDATE search_conversations
       SET status = 'completed',
           pending_slot = NULL,
           service_text = $3,
           location_text = $4,
           last_message_text = $5,
           search_request_id = $6,
           processing_token = NULL,
           processing_started_at = NULL,
           completed_at = NOW()
       WHERE id = $1 AND status = 'active' AND processing_token = $2
       RETURNING id`,
      [
        input.id,
        input.processingToken,
        input.serviceText,
        input.locationText,
        input.lastMessageText,
        input.searchRequestId,
      ],
    );
    return result.rows.length === 1;
  }

  async releaseClaim(id: string, processingToken: string) {
    await this.execute(
      `UPDATE search_conversations
       SET processing_token = NULL, processing_started_at = NULL
       WHERE id = $1 AND status = 'active' AND processing_token = $2`,
      [id, processingToken],
    );
  }
}
