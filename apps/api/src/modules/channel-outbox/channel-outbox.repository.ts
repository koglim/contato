import type { QueryResultRow } from "pg";
import { resumedMatchEligibilitySql } from "../professional-opportunity/resumed-match-eligibility.js";
import { BILATERAL_NOTICE, BILATERAL_NOTICE_VERSION } from "../bilateral-contact/bilateral-contact.policy.js";
import { MAX_PRESENTED_PER_SEARCH, PRESENTATION_PAGE_SIZE } from "../matching/matching-policy.js";
import { query, withTransaction, type DatabaseClient, type SqlValue } from "../../database/connection.js";
import type {
  ChannelOutboundMessageRecord,
  ChannelOutboundMessageRepository,
  CreateChannelOutboundMessage,
  CreateIndependentChannelOutboundMessage,
} from "./channel-outbox.types.js";
import type { ChannelOutboundMessageStatus, MarkChannelOutboundMessageFailedInput, MarkChannelOutboundMessageSentInput } from "@contatocerto/shared";
import { OUTBOX_MAX_ATTEMPTS, OUTBOX_RETRY_BACKOFF_SECONDS } from "./channel-outbox.retry.js";

const retryBackoffSql = OUTBOX_RETRY_BACKOFF_SECONDS
  .map((seconds, index) => `WHEN ${index + 1} THEN ${seconds}`)
  .join(" ");

export type ChannelOutboundMessageRow = {
  id: string;
  channel_inbound_message_id: string | null;
  purpose: ChannelOutboundMessageRecord["purpose"];
  provider: string;
  recipient_phone_e164: string;
  message_type: "text";
  text_content: string;
  status: ChannelOutboundMessageStatus;
  processing_token: string | null;
  processing_started_at: Date | null;
  provider_message_id: string | null;
  attempt_count: number;
  last_error_code: string | null;
  sent_at: Date | null;
  next_attempt_at: Date | null;
};

export type ChannelOutboxQuery = <T extends QueryResultRow>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>;
export type ChannelOutboxTransaction = <T>(callback: (client: DatabaseClient) => Promise<T>) => Promise<T>;

export const channelOutboundMessageColumns = `
  id, channel_inbound_message_id, purpose, provider, recipient_phone_e164, message_type, text_content,
  status, processing_token, processing_started_at, provider_message_id, attempt_count, last_error_code, sent_at,
  next_attempt_at
`;

const qualifiedChannelOutboundMessageColumns = `
  outbound.id, outbound.channel_inbound_message_id, outbound.purpose, outbound.provider,
  outbound.recipient_phone_e164, outbound.message_type, outbound.text_content, outbound.status,
  outbound.processing_token, outbound.processing_started_at, outbound.provider_message_id,
  outbound.attempt_count, outbound.last_error_code, outbound.sent_at, outbound.next_attempt_at
`;

export class MatchReservationConflictError extends Error {
  readonly code = "match_reservation_conflict";

  constructor() {
    super("A match is already reserved for another outbound message");
    this.name = "MatchReservationConflictError";
  }
}

export function toChannelOutboundMessageRecord(row: ChannelOutboundMessageRow): ChannelOutboundMessageRecord {
  return {
    id: row.id,
    channelInboundMessageId: row.channel_inbound_message_id,
    purpose: row.purpose,
    provider: row.provider,
    recipientPhoneE164: row.recipient_phone_e164,
    messageType: row.message_type,
    textContent: row.text_content,
    status: row.status,
    processingToken: row.processing_token,
    processingStartedAt: row.processing_started_at,
    providerMessageId: row.provider_message_id,
    attemptCount: row.attempt_count,
    lastErrorCode: row.last_error_code,
    sentAt: row.sent_at,
    nextAttemptAt: row.next_attempt_at,
  };
}

const defaultQuery: ChannelOutboxQuery = (text, values = []) => query(text, values as SqlValue[]);

export async function createIndependentOutbound(client: DatabaseClient, input: CreateIndependentChannelOutboundMessage) {
  if (!input.businessKey.trim() || !input.textContent.trim() || !/^\+[1-9]\d{7,14}$/u.test(input.recipientPhoneE164)) {
    throw new Error("Invalid independent outbound context");
  }
  const inserted = await client.query<ChannelOutboundMessageRow>(
    `INSERT INTO channel_outbound_messages (
       channel_inbound_message_id, purpose, provider, recipient_phone_e164, text_content, business_key
     ) VALUES (NULL, $1, $2, $3, $4, $5)
     ON CONFLICT (business_key) WHERE business_key IS NOT NULL DO NOTHING
     RETURNING ${channelOutboundMessageColumns}`,
    [input.purpose, input.provider, input.recipientPhoneE164, input.textContent, input.businessKey],
  );
  if (inserted.rows[0]) return toChannelOutboundMessageRecord(inserted.rows[0]);
  const existing = await client.query<ChannelOutboundMessageRow>(
    `SELECT ${channelOutboundMessageColumns} FROM channel_outbound_messages WHERE business_key = $1`, [input.businessKey],
  );
  const row = existing.rows[0];
  if (!row || row.purpose !== input.purpose || row.provider !== input.provider
    || row.recipient_phone_e164 !== input.recipientPhoneE164 || row.text_content !== input.textContent) {
    throw new Error("Independent outbound idempotency conflict");
  }
  // No UPDATE: replay cannot reset sent, lease, attempts, timestamps or content.
  return toChannelOutboundMessageRecord(row);
}

export async function associateOutboundMessageMatches(
  client: DatabaseClient,
  outboundMessageId: string,
  input: Pick<CreateChannelOutboundMessage, "searchRequestId" | "matchIds">,
) {
  const matchIds = [...new Set(input.matchIds)];
  if (matchIds.length === 0) return;
  if (!input.searchRequestId) throw new Error("A search request is required when associating outbound matches");
  if (matchIds.length > PRESENTATION_PAGE_SIZE) throw new MatchReservationConflictError();

  // Serialize reservations for this search, including disjoint pages computed
  // from stale reads. Sending happens outside this short transaction.
  // Inbox FK writes may already hold KEY SHARE on this row. NO KEY UPDATE
  // serializes reservers without deadlocking on concurrent FK lock upgrades.
  await client.query("SELECT id FROM search_requests WHERE id = $1 FOR NO KEY UPDATE", [input.searchRequestId]);

  const valid = await client.query<{ id: string }>(
    `SELECT id
       FROM matches
      WHERE search_request_id = $1
        AND rank_position IS NOT NULL
        AND rank_position <= $3
        AND shown_at IS NULL
        AND ${resumedMatchEligibilitySql}
        AND id = ANY($2::uuid[])
        AND EXISTS (SELECT 1 FROM search_requests WHERE id = $1 AND status = 'matched')
        AND NOT EXISTS (
          SELECT 1 FROM matches pending
          JOIN channel_outbound_message_matches reservation ON reservation.match_id = pending.id
          WHERE pending.search_request_id = $1 AND pending.shown_at IS NULL
        )`,
    [input.searchRequestId, matchIds, MAX_PRESENTED_PER_SEARCH],
  );
  if (valid.rows.length !== matchIds.length) {
    throw new MatchReservationConflictError();
  }

  try {
    await client.query(
      `INSERT INTO channel_outbound_message_matches (channel_outbound_message_id, match_id)
       SELECT $1, match_id
         FROM unnest($2::uuid[]) AS input(match_id)`,
      [outboundMessageId, matchIds],
    );
  } catch (error) {
    if (typeof error === "object" && error !== null
      && "code" in error && (error as { code?: unknown }).code === "23505"
      && "constraint" in error
      && (error as { constraint?: unknown }).constraint === "channel_outbound_message_matches_match_id_unique_idx") {
      throw new MatchReservationConflictError();
    }
    throw error;
  }
}

export class PostgresChannelOutboundMessageRepository implements ChannelOutboundMessageRepository {
  constructor(
    private readonly execute: ChannelOutboxQuery = defaultQuery,
    private readonly transaction: ChannelOutboxTransaction = withTransaction,
  ) {}

  async findById(id: string) {
    const result = await this.execute<ChannelOutboundMessageRow>(
      `SELECT ${channelOutboundMessageColumns} FROM channel_outbound_messages WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toChannelOutboundMessageRecord(result.rows[0]) : null;
  }

  async findByInboundMessageId(channelInboundMessageId: string) {
    const result = await this.execute<ChannelOutboundMessageRow>(
      `SELECT ${channelOutboundMessageColumns} FROM channel_outbound_messages WHERE channel_inbound_message_id = $1`,
      [channelInboundMessageId],
    );
    return result.rows[0] ? toChannelOutboundMessageRecord(result.rows[0]) : null;
  }

  async createOrFindForProcessedInbound(input: CreateChannelOutboundMessage) {
    return this.transaction(async (client) => {
      const result = await client.query<ChannelOutboundMessageRow>(
      `INSERT INTO channel_outbound_messages (
         channel_inbound_message_id, purpose, provider, recipient_phone_e164, text_content, bilateral_notice_version
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (channel_inbound_message_id) WHERE channel_inbound_message_id IS NOT NULL DO UPDATE
         SET channel_inbound_message_id = EXCLUDED.channel_inbound_message_id
       RETURNING ${channelOutboundMessageColumns}`,
        [input.channelInboundMessageId, "customer_reply", input.provider, input.recipientPhoneE164, input.textContent,
          input.textContent.includes(BILATERAL_NOTICE) ? BILATERAL_NOTICE_VERSION : null],
      );
      await associateOutboundMessageMatches(client, result.rows[0].id, input);
      return toChannelOutboundMessageRecord(result.rows[0]);
    });
  }

  async createIndependent(input: CreateIndependentChannelOutboundMessage) {
    return this.transaction((client) => createIndependentOutbound(client, input));
  }

  async claim(id: string, processingToken: string, processingLeaseSeconds: number) {
    const result = await this.execute<ChannelOutboundMessageRow>(
      `UPDATE channel_outbound_messages
       SET status = 'processing', processing_token = $2, processing_started_at = NOW(),
           next_attempt_at = NULL, attempt_count = attempt_count + 1
       WHERE id = $1
         AND (
           (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
           OR (status = 'failed' AND attempt_count < $4 AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
           OR (status = 'processing' AND processing_started_at <= NOW() - ($3 * INTERVAL '1 second'))
         )
       RETURNING ${channelOutboundMessageColumns}`,
      [id, processingToken, processingLeaseSeconds, OUTBOX_MAX_ATTEMPTS],
    );
    return result.rows[0] ? toChannelOutboundMessageRecord(result.rows[0]) : null;
  }

  async claimNextPending(processingToken: string, processingLeaseSeconds: number) {
    const result = await this.execute<ChannelOutboundMessageRow>(
      `WITH candidate AS (
         SELECT id
           FROM channel_outbound_messages
          WHERE (
            (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
            OR (status = 'failed' AND attempt_count < $2 AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
          )
             OR (status = 'processing' AND processing_started_at <= NOW() - ($1 * INTERVAL '1 second'))
          ORDER BY created_at ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       UPDATE channel_outbound_messages AS outbound
          SET status = 'processing', processing_token = $3, processing_started_at = NOW(),
              next_attempt_at = NULL, attempt_count = attempt_count + 1
         FROM candidate
        WHERE outbound.id = candidate.id
       RETURNING ${qualifiedChannelOutboundMessageColumns}`,
      [processingLeaseSeconds, OUTBOX_MAX_ATTEMPTS, processingToken],
    );
    return result.rows[0] ? toChannelOutboundMessageRecord(result.rows[0]) : null;
  }

  async markSent(id: string, input: MarkChannelOutboundMessageSentInput) {
    return this.transaction(async (client) => {
      const result = await client.query<{ id: string }>(
      `UPDATE channel_outbound_messages
       SET status = 'sent', provider_message_id = $3, sent_at = NOW(), processing_token = NULL,
           processing_started_at = NULL, next_attempt_at = NULL, last_error_code = NULL
       WHERE id = $1 AND status = 'processing' AND processing_token = $2
       RETURNING id`,
        [id, input.processing_token, input.provider_message_id],
      );
      if (result.rows.length !== 1) return false;
      await client.query(
        `UPDATE matches
            SET shown_at = COALESCE(shown_at, NOW())
           FROM channel_outbound_message_matches
          WHERE channel_outbound_message_matches.channel_outbound_message_id = $1
            AND matches.id = channel_outbound_message_matches.match_id`,
        [id],
      );
      return true;
    });
  }

  async markFailed(id: string, input: MarkChannelOutboundMessageFailedInput) {
    const result = await this.execute<{ id: string }>(
      `UPDATE channel_outbound_messages
       SET status = CASE WHEN attempt_count >= $4 THEN 'failed' ELSE 'pending' END,
           next_attempt_at = CASE WHEN attempt_count >= $4 THEN NULL
             ELSE NOW() + (CASE attempt_count ${retryBackoffSql} ELSE ${OUTBOX_RETRY_BACKOFF_SECONDS.at(-1)} END * INTERVAL '1 second') END,
           last_error_code = $3, processing_token = NULL, processing_started_at = NULL
       WHERE id = $1 AND status = 'processing' AND processing_token = $2
       RETURNING id`,
      [id, input.processing_token, input.error_code, OUTBOX_MAX_ATTEMPTS],
    );
    return result.rows.length === 1;
  }
}
