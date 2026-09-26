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
import type { ChannelOutboundQueueStatus, ChannelOutboundMessageStatus, MarkChannelOutboundMessageFailedInput, MarkChannelOutboundMessageSentInput } from "@contatocerto/shared";
import { OUTBOX_MAX_ATTEMPTS, OUTBOX_RETRY_BACKOFF_SECONDS } from "./channel-outbox.retry.js";
import { CUSTOMER_REPLY_EXPIRY_REASON, CUSTOMER_REPLY_MAX_AGE_SECONDS } from "./channel-outbox.expiry.js";

const retryBackoffSql = OUTBOX_RETRY_BACKOFF_SECONDS
  .map((seconds, index) => `WHEN ${index + 1} THEN ${seconds}`)
  .join(" ");

// A crashed consumer cannot reserve a sixth attempt. Use SKIP LOCKED for the
// terminalization too: unrelated queue consumers must never wait on this sweep.
function exhaustAbandonedSql(leaseParameter: string, maxParameter: string) {
  return `UPDATE channel_outbound_messages SET status = 'failed',
    processing_token = NULL, processing_started_at = NULL, next_attempt_at = NULL,
    last_error_code = 'lease_attempt_limit'
    WHERE id IN (SELECT id FROM channel_outbound_messages
      WHERE status = 'processing' AND delivery_hold_reason IS NULL
        AND attempt_count >= ${maxParameter}
        AND processing_started_at <= NOW() - (${leaseParameter} * INTERVAL '1 second')
      FOR UPDATE SKIP LOCKED)`;
}

function expireCustomerRepliesSql(
  leaseParameter: string,
  maxAttemptsParameter: string,
  maxAgeParameter: string,
  reasonParameter: string,
  idPredicate = "TRUE",
) {
  return `expired_customer_reply_candidates AS (
      SELECT expirable.id
        FROM channel_outbound_messages AS expirable
       WHERE ${idPredicate}
         AND expirable.purpose = 'customer_reply'
         AND expirable.administrative_closed_at IS NULL
         AND expirable.delivery_hold_reason IS NULL
         AND expirable.created_at <= clock_timestamp() - (${maxAgeParameter} * INTERVAL '1 second')
         AND (
           expirable.status = 'pending'
           OR (expirable.status = 'failed' AND expirable.attempt_count < ${maxAttemptsParameter})
           OR (expirable.status = 'processing' AND expirable.attempt_count < ${maxAttemptsParameter}
             AND expirable.processing_started_at <= clock_timestamp() - (${leaseParameter} * INTERVAL '1 second'))
         )
       FOR UPDATE SKIP LOCKED
    ), expired_customer_replies AS (
      UPDATE channel_outbound_messages AS expired
         SET status = 'failed', processing_token = NULL, processing_started_at = NULL,
             next_attempt_at = NULL, last_error_code = ${reasonParameter},
             administrative_closed_at = clock_timestamp()
        FROM expired_customer_reply_candidates AS candidate
       WHERE expired.id = candidate.id
       RETURNING expired.id
    ), customer_reply_expiry_audit AS (
      INSERT INTO channel_transport_events(outbound_id,event_key,action,reason,payload_hash,result)
      SELECT expired.id, 'customer_reply_expiry_v1', 'close', ${reasonParameter},
        encode(digest(expired.id::text || ':' || ${reasonParameter}::text, 'sha256'), 'hex'),
        jsonb_build_object('status','failed','reason',${reasonParameter}::text)
        FROM expired_customer_replies AS expired
      ON CONFLICT(outbound_id,event_key) DO NOTHING
    )`;
}

function expireAuthChallengesSql() {
  return `expired_auth_candidates AS (
    SELECT id FROM channel_outbound_messages WHERE purpose='professional_auth_challenge'
      AND expires_at<=clock_timestamp() AND status<>'sent' AND administrative_closed_at IS NULL
    FOR UPDATE SKIP LOCKED
  ), expired_auth AS (
    UPDATE channel_outbound_messages outbound SET status='failed',last_error_code='auth_challenge_expired',
      administrative_closed_at=clock_timestamp(),processing_token=NULL,processing_started_at=NULL,next_attempt_at=NULL
    FROM expired_auth_candidates candidate WHERE outbound.id=candidate.id RETURNING outbound.id
  ), auth_expiry_audit AS (
    INSERT INTO channel_transport_events(outbound_id,event_key,action,reason,payload_hash,result)
    SELECT id,'professional_auth_expiry_v1','close','auth_challenge_expired',
      encode(digest(id::text||':auth_challenge_expired','sha256'),'hex'),'{"status":"failed","reason":"auth_challenge_expired"}'::jsonb
    FROM expired_auth ON CONFLICT(outbound_id,event_key) DO NOTHING
  )`;
}

// Independent business notifications are FIFO. Inline replies retain their
// compatibility path (including a new delivered consent prompt replacing an
// unsent prompt); they must not be blocked by an older inline reply.
const recipientTurnSql = `outbound.administrative_closed_at IS NULL AND (outbound.purpose NOT IN ('professional_contact_notification', 'customer_contact_update') OR NOT EXISTS (
  SELECT 1 FROM channel_outbound_messages earlier
  WHERE earlier.provider = outbound.provider
    AND earlier.recipient_phone_e164 = outbound.recipient_phone_e164
    AND earlier.purpose IN ('professional_contact_notification', 'customer_contact_update') AND earlier.administrative_closed_at IS NULL
    AND (earlier.created_at, earlier.id) < (outbound.created_at, outbound.id)
    AND (earlier.status IN ('pending', 'processing')
      OR (earlier.status = 'failed' AND earlier.attempt_count < ${OUTBOX_MAX_ATTEMPTS}))
)) AND NOT EXISTS (
  SELECT 1 FROM channel_outbound_messages earlier WHERE earlier.provider=outbound.provider
    AND earlier.recipient_phone_e164=outbound.recipient_phone_e164
    AND (outbound.purpose='channel_notice' OR earlier.purpose='channel_notice')
    AND (earlier.created_at,earlier.id)<(outbound.created_at,outbound.id)
    AND earlier.administrative_closed_at IS NULL
    AND (earlier.status IN ('pending','processing') OR (earlier.status='failed' AND earlier.attempt_count<${OUTBOX_MAX_ATTEMPTS}))
)`;

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
  administrative_closed_at: Date | null;
  expires_at: Date | null;
};

export type ChannelOutboxQuery = <T extends QueryResultRow>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>;
export type ChannelOutboxTransaction = <T>(callback: (client: DatabaseClient) => Promise<T>) => Promise<T>;

export const channelOutboundMessageColumns = `
  id, channel_inbound_message_id, purpose, provider, recipient_phone_e164, message_type, text_content,
  status, processing_token, processing_started_at, provider_message_id, attempt_count, last_error_code, sent_at,
  next_attempt_at, administrative_closed_at, expires_at
`;

const qualifiedChannelOutboundMessageColumns = `
  outbound.id, outbound.channel_inbound_message_id, outbound.purpose, outbound.provider,
  outbound.recipient_phone_e164, outbound.message_type, outbound.text_content, outbound.status,
  outbound.processing_token, outbound.processing_started_at, outbound.provider_message_id,
  outbound.attempt_count, outbound.last_error_code, outbound.sent_at, outbound.next_attempt_at,
  outbound.administrative_closed_at, outbound.expires_at
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
    administrativeClosedAt: row.administrative_closed_at,
    expiresAt: row.expires_at,
  };
}

const defaultQuery: ChannelOutboxQuery = (text, values = []) => query(text, values as SqlValue[]);

export async function createIndependentOutbound(client: DatabaseClient, input: CreateIndependentChannelOutboundMessage) {
  if (!input.businessKey.trim() || !input.textContent.trim() || !/^\+[1-9]\d{7,14}$/u.test(input.recipientPhoneE164)) {
    throw new Error("Invalid independent outbound context");
  }
  const inserted = await client.query<ChannelOutboundMessageRow>(
    `INSERT INTO channel_outbound_messages (
       channel_inbound_message_id, purpose, provider, recipient_phone_e164, text_content, business_key, expires_at
     ) VALUES (NULL, $1, $2, $3, $4, $5, $6)
     ON CONFLICT (business_key) WHERE business_key IS NOT NULL DO NOTHING
     RETURNING ${channelOutboundMessageColumns}`,
    [input.purpose, input.provider, input.recipientPhoneE164, input.textContent, input.businessKey, input.expiresAt ?? null],
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
  async queueStatus(processingLeaseSeconds: number): Promise<ChannelOutboundQueueStatus> {
    type Row = Omit<ChannelOutboundQueueStatus["items"][number], "oldest_unfinished_at"> & { oldest_unfinished_at: Date };
    const result = await this.execute<Row>(
      `SELECT purpose,
        COUNT(*) FILTER (WHERE status = 'pending')::float8 AS pending,
        COUNT(*) FILTER (WHERE status = 'pending' AND next_attempt_at > NOW())::float8 AS scheduled_retry,
        COUNT(*) FILTER (WHERE status = 'processing')::float8 AS processing,
        COUNT(*) FILTER (WHERE status = 'processing' AND delivery_hold_reason IS NULL
          AND processing_started_at <= NOW() - ($1 * INTERVAL '1 second'))::float8 AS expired_lease,
        COUNT(*) FILTER (WHERE delivery_hold_reason IS NOT NULL)::float8 AS reconciliation_required,
        COUNT(*) FILTER (WHERE status = 'failed')::float8 AS failed,
        COUNT(*) FILTER (WHERE status = 'failed' AND attempt_count >= $2)::float8 AS dead_letter,
        MIN(created_at) AS oldest_unfinished_at
      FROM channel_outbound_messages WHERE status <> 'sent'
      GROUP BY purpose ORDER BY purpose`,
      [processingLeaseSeconds, OUTBOX_MAX_ATTEMPTS],
    );
    return { items: result.rows.map((row) => ({ ...row, oldest_unfinished_at: row.oldest_unfinished_at.toISOString() })) };
  }

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
      `WITH ${expireAuthChallengesSql()}, ${expireCustomerRepliesSql("$3", "$4", "$5", "$6", "expirable.id = $1")},
       exhausted AS (${exhaustAbandonedSql("$3", "$4")})
       UPDATE channel_outbound_messages AS outbound
       SET status = 'processing', processing_token = $2, processing_started_at = NOW(),
           next_attempt_at = NULL, attempt_count = attempt_count + 1
       WHERE id = $1
         AND attempt_count < $4 AND delivery_hold_reason IS NULL
         AND administrative_closed_at IS NULL
         AND (expires_at IS NULL OR expires_at > clock_timestamp())
         AND (purpose <> 'customer_reply' OR created_at > clock_timestamp() - ($5 * INTERVAL '1 second'))
         AND ${recipientTurnSql}
         AND (
           (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
           OR (status = 'failed' AND attempt_count < $4 AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
           OR (status = 'processing' AND processing_started_at <= NOW() - ($3 * INTERVAL '1 second'))
         )
       RETURNING ${channelOutboundMessageColumns}`,
      [id, processingToken, processingLeaseSeconds, OUTBOX_MAX_ATTEMPTS,
        CUSTOMER_REPLY_MAX_AGE_SECONDS, CUSTOMER_REPLY_EXPIRY_REASON],
    );
    return result.rows[0] ? toChannelOutboundMessageRecord(result.rows[0]) : null;
  }

  async claimNextPending(processingToken: string, processingLeaseSeconds: number) {
    const result = await this.execute<ChannelOutboundMessageRow>(
      `WITH ${expireAuthChallengesSql()}, ${expireCustomerRepliesSql("$1", "$2", "$4", "$5")},
       exhausted AS (${exhaustAbandonedSql("$1", "$2")}), candidate AS (
         SELECT outbound.id
           FROM channel_outbound_messages AS outbound
          WHERE attempt_count < $2 AND delivery_hold_reason IS NULL
            AND outbound.administrative_closed_at IS NULL
            AND (outbound.expires_at IS NULL OR outbound.expires_at > clock_timestamp())
            AND (outbound.purpose <> 'customer_reply'
              OR outbound.created_at > clock_timestamp() - ($4 * INTERVAL '1 second'))
            AND ${recipientTurnSql}
            AND ((
            (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
            OR (status = 'failed' AND attempt_count < $2 AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
          )
             OR (status = 'processing' AND processing_started_at <= NOW() - ($1 * INTERVAL '1 second')))
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
      [processingLeaseSeconds, OUTBOX_MAX_ATTEMPTS, processingToken,
        CUSTOMER_REPLY_MAX_AGE_SECONDS, CUSTOMER_REPLY_EXPIRY_REASON],
    );
    return result.rows[0] ? toChannelOutboundMessageRecord(result.rows[0]) : null;
  }

  async markSent(id: string, input: MarkChannelOutboundMessageSentInput) {
    return this.transaction(async (client) => {
      const result = await client.query<{ id: string }>(
      `UPDATE channel_outbound_messages
       SET status = 'sent', provider_message_id = $3, sent_at = NOW(), processing_token = NULL,
           processing_started_at = NULL, next_attempt_at = NULL, last_error_code = NULL,
           sent_token_hash = encode(digest($2::text, 'sha256'), 'hex'), delivery_hold_reason = NULL
       WHERE id = $1 AND status = 'processing' AND processing_token = $2
         AND (provider_message_id IS NULL OR provider_message_id=$3)
       RETURNING id`,
        [id, input.processing_token, input.provider_message_id],
      );
      if (result.rows.length !== 1) {
        // Separate statement gives a fresh READ COMMITTED snapshot after a
        // competing confirmation commits. Never touch timestamps on replay.
        const receipt = await client.query<{ id: string }>(`SELECT id FROM channel_outbound_messages
          WHERE id = $1 AND status = 'sent' AND provider_message_id = $3
            AND sent_token_hash = encode(digest($2::text, 'sha256'), 'hex')`,
        [id, input.processing_token, input.provider_message_id]);
        return receipt.rows.length === 1;
      }
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
       SET status = CASE WHEN attempt_count >= $4
         THEN 'failed'::channel_outbound_message_status
         ELSE 'pending'::channel_outbound_message_status END,
           next_attempt_at = CASE WHEN attempt_count >= $4 THEN NULL
             ELSE NOW() + (CASE attempt_count ${retryBackoffSql} ELSE ${OUTBOX_RETRY_BACKOFF_SECONDS.at(-1)} END * INTERVAL '1 second') END,
           last_error_code = $3, processing_token = NULL, processing_started_at = NULL
       WHERE id = $1 AND status = 'processing' AND processing_token = $2 AND delivery_hold_reason IS NULL
       RETURNING id`,
      [id, input.processing_token, input.error_code, OUTBOX_MAX_ATTEMPTS],
    );
    return result.rows.length === 1;
  }

  async holdDelivery(id: string, input: { processing_token: string; reason: "transport_outcome_unknown" | "confirmation_pending"; provider_message_id?: string }) {
    const result = await this.execute<{ id: string }>(`WITH held AS (UPDATE channel_outbound_messages
      SET delivery_hold_reason = $3, last_error_code = $3,
        delivery_held_at=CASE WHEN delivery_hold_reason IS NULL THEN clock_timestamp() ELSE COALESCE(delivery_held_at,clock_timestamp()) END,
        provider_message_id=COALESCE(provider_message_id,$4)
      WHERE id = $1 AND status = 'processing' AND processing_token = $2
        AND (delivery_hold_reason IS NULL OR delivery_hold_reason = $3)
        AND ($4::text IS NULL OR provider_message_id IS NULL OR provider_message_id=$4)
      RETURNING id), audit AS (
        INSERT INTO channel_transport_events(outbound_id,event_key,action,reason,payload_hash,provider_message_id,result)
        SELECT id,'hold_'||encode(digest($2::text||$3::text||COALESCE($4::text,''),'sha256'),'hex'),'hold',$3,
          encode(digest($2::text||$3::text||COALESCE($4::text,''),'sha256'),'hex'),$4,'{}' FROM held
        ON CONFLICT(outbound_id,event_key) DO NOTHING
      ) SELECT id FROM held`, [id, input.processing_token, input.reason, input.provider_message_id??null]);
    return result.rows.length === 1;
  }
}
