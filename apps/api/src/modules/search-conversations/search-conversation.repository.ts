import type { QueryResultRow } from "pg";
import { query, type SqlValue } from "../../database/connection.js";
import type {
  CreatePendingLocationConversation,
  SearchConversationRecord,
  SearchConversationRepository,
  SearchConversationStatus,
} from "./search-conversation.types.js";

type SearchConversationRow = {
  id: string;
  customer_id: string | null;
  status: SearchConversationStatus;
  pending_slot: "location" | null;
  original_raw_text: string;
  service_text: string;
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
  id, customer_id, status, pending_slot, original_raw_text, service_text, country_code,
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

  async createPendingLocation(input: CreatePendingLocationConversation) {
    const result = await this.execute<SearchConversationRow>(
      `INSERT INTO search_conversations (
         status, pending_slot, original_raw_text, service_text, country_code,
         limit_value, last_message_text, expires_at
       ) VALUES ('active', 'location', $1, $2, $3, $4, $1, NOW() + ($5 * INTERVAL '1 minute'))
       RETURNING ${conversationColumns}`,
      [input.originalRawText, input.serviceText, input.countryCode, input.limitValue, input.ttlMinutes],
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

  async claimPendingLocation(id: string, processingToken: string) {
    const result = await this.execute<SearchConversationRow>(
      `UPDATE search_conversations
       SET processing_token = $2, processing_started_at = NOW()
       WHERE id = $1
         AND status = 'active'
         AND pending_slot = 'location'
         AND expires_at > NOW()
         AND processing_token IS NULL
       RETURNING ${conversationColumns}`,
      [id, processingToken],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async touchPendingLocation(id: string, processingToken: string, lastMessageText: string, ttlMinutes: number) {
    const result = await this.execute<{ id: string }>(
      `UPDATE search_conversations
       SET last_message_text = $3,
           expires_at = NOW() + ($4 * INTERVAL '1 minute'),
           processing_token = NULL,
           processing_started_at = NULL
       WHERE id = $1 AND status = 'active' AND processing_token = $2
       RETURNING id`,
      [id, processingToken, lastMessageText, ttlMinutes],
    );
    return result.rows.length === 1;
  }

  async complete(id: string, processingToken: string, lastMessageText: string, searchRequestId: string | null) {
    const result = await this.execute<{ id: string }>(
      `UPDATE search_conversations
       SET status = 'completed',
           pending_slot = NULL,
           last_message_text = $3,
           search_request_id = $4,
           processing_token = NULL,
           processing_started_at = NULL,
           completed_at = NOW()
       WHERE id = $1 AND status = 'active' AND processing_token = $2
       RETURNING id`,
      [id, processingToken, lastMessageText, searchRequestId],
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
