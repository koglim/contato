import type { QueryResultRow } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { inboxErrorCode, isInboxPermanent, InboxFenceError, InboxContextChangedError, inboxContextSql, liveInboxLeaseSql, INBOX_MAX_ATTEMPTS } from "./inbox-recovery.policy.js";
import { BILATERAL_NOTICE, BILATERAL_NOTICE_VERSION } from "../bilateral-contact/bilateral-contact.policy.js";
import { query, withTransaction, inDatabaseTransaction, type DatabaseClient, type SqlValue } from "../../database/connection.js";
import type {
  ChannelInboundMessageRecord,
  ChannelInboundMessageRepository,
  ChannelInboundMessageStatus,
  MarkProcessedInboundMessageWithOutbound,
} from "./channel-inbox.types.js";
import type { ChannelInboundMessageInput } from "@contatocerto/shared";
import {
  channelOutboundMessageColumns,
  associateOutboundMessageMatches,
  toChannelOutboundMessageRecord,
  type ChannelOutboundMessageRow,
} from "../channel-outbox/channel-outbox.repository.js";

type ChannelInboundMessageRow = {
  id: string;
  provider: string;
  provider_message_id: string;
  phone_e164: string;
  raw_text: string;
  country_code: string;
  limit_value: number;
  status: ChannelInboundMessageStatus;
  customer_id: string | null;
  conversation_id: string | null;
  search_request_id: string | null;
  result: unknown;
  error_code: string | null;
  processing_token: string | null;
  processing_started_at: Date | null;
  recovery_state: "active" | "quarantined" | "closed";
  contextual_queue: boolean;
  attempt_count: number;
  context_fingerprint: string | null;
};

export type ChannelInboxQuery = <T extends QueryResultRow>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>;
export type ChannelInboxTransaction = <T>(callback: (client: DatabaseClient) => Promise<T>) => Promise<T>;

const columns = `
  id, provider, provider_message_id, phone_e164, raw_text, country_code, limit_value,
  status, customer_id, conversation_id, search_request_id,
  result, error_code, processing_token, processing_started_at, recovery_state, contextual_queue, attempt_count, context_fingerprint
`;

function toRecord(row: ChannelInboundMessageRow): ChannelInboundMessageRecord {
  return {
    id: row.id,
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    phoneE164: row.phone_e164,
    rawText: row.raw_text,
    countryCode: row.country_code,
    limitValue: row.limit_value,
    status: row.status,
    customerId: row.customer_id,
    conversationId: row.conversation_id,
    searchRequestId: row.search_request_id,
    result: row.result,
    errorCode: row.error_code,
    processingToken: row.processing_token,
    processingStartedAt: row.processing_started_at,
    recoveryState: row.recovery_state,
    contextualQueue: row.contextual_queue,
    attemptCount: row.attempt_count,
    contextFingerprint: row.context_fingerprint,
  };
}

const defaultQuery: ChannelInboxQuery = (text, values = []) => query(text, values as SqlValue[]);

export class PostgresChannelInboundMessageRepository implements ChannelInboundMessageRepository {
  constructor(
    private readonly execute: ChannelInboxQuery = defaultQuery,
    private readonly transaction: ChannelInboxTransaction = withTransaction,
  ) {}

  async createOrFind(input: ChannelInboundMessageInput, options?: { contextual: boolean }) {
    const inserted = await this.execute<ChannelInboundMessageRow>(
      `INSERT INTO channel_inbound_messages (
         provider, provider_message_id, phone_e164, raw_text, country_code, limit_value${options?.contextual ? ", contextual_queue" : ""}
       ) VALUES ($1, $2, $3, $4, $5, $6${options?.contextual ? ", TRUE" : ""})
       ON CONFLICT (provider, provider_message_id) DO NOTHING
       RETURNING ${columns}`,
      [input.provider, input.provider_message_id, input.phone_e164, input.raw_text, input.country_code, input.limit],
    );
    if (inserted.rows[0]) return { record: toRecord(inserted.rows[0]), created: true };

    const existing = await this.execute<ChannelInboundMessageRow>(
      `SELECT ${columns} FROM channel_inbound_messages
       WHERE provider = $1 AND provider_message_id = $2`,
      [input.provider, input.provider_message_id],
    );
    if (!existing.rows[0]) throw new Error("Channel inbound message was not found after conflict");
    return { record: toRecord(existing.rows[0]), created: false };
  }

  async findById(id: string) {
    const result = await this.execute<ChannelInboundMessageRow>(
      `SELECT ${columns} FROM channel_inbound_messages WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async claim(id: string, processingToken: string, processingLeaseSeconds: number) {
    return this.claimEligible(id, processingToken, processingLeaseSeconds);
  }

  async claimNext(processingLeaseSeconds: number, allowContextual = false) {
    return this.claimEligible(null, randomUUID(), processingLeaseSeconds, allowContextual);
  }

  private async claimEligible(id: string | null, token: string, leaseSeconds: number, allowContextual = true) {
    // The claim already consumed the abandoned attempt. Settling it must not consume a second one.
    await this.execute(`WITH abandoned AS (
      SELECT id FROM channel_inbound_messages WHERE recovery_state = 'active' AND status = 'processing'
        AND COALESCE(lease_expires_at, processing_started_at + ($1 * INTERVAL '1 second')) <= clock_timestamp()
      ORDER BY created_at,id LIMIT 100 FOR UPDATE SKIP LOCKED
    ), settled AS (
      UPDATE channel_inbound_messages i SET status = 'failed', processing_token = NULL, processing_started_at = NULL,
        lease_expires_at = NULL, attempt_count = GREATEST(1, attempt_count), total_attempts = GREATEST(1,total_attempts),
        error_code = 'lease_abandoned',
        next_attempt_at = CASE WHEN attempt_count < $2 THEN clock_timestamp() + (30 * power(2,GREATEST(attempt_count,1)-1)) * INTERVAL '1 second' END,
        recovery_state = CASE WHEN attempt_count >= $2 THEN 'quarantined' ELSE 'active' END,
        quarantined_at = CASE WHEN attempt_count >= $2 THEN clock_timestamp() END,
        recovery_reason = CASE WHEN attempt_count >= $2 THEN 'attempts_exhausted' END
      FROM abandoned a WHERE i.id = a.id RETURNING i.id,i.recovery_state,i.total_attempts
    ) INSERT INTO channel_inbound_recovery_events(inbound_id,event_key,action,reason)
      SELECT id,'exhausted_' || total_attempts,'quarantine','attempts_exhausted' FROM settled WHERE recovery_state = 'quarantined'
      ON CONFLICT(inbound_id,event_key) DO NOTHING`, [leaseSeconds, INBOX_MAX_ATTEMPTS]);
    const result = await this.execute<ChannelInboundMessageRow>(
      `WITH candidate AS (
        SELECT i.id FROM channel_inbound_messages i WHERE ($1::uuid IS NULL OR i.id = $1)
          AND i.recovery_state = 'active' AND i.status IN ('received', 'failed') AND i.attempt_count < $5
          AND ($4 OR NOT i.contextual_queue)
          AND (i.next_attempt_at IS NULL OR i.next_attempt_at <= clock_timestamp())
          AND NOT EXISTS (SELECT 1 FROM channel_inbound_messages older WHERE older.phone_e164 = i.phone_e164
            AND (older.status <> 'processed' OR older.recovery_state = 'quarantined') AND older.recovery_state <> 'closed'
            AND (older.created_at,older.id) < (i.created_at,i.id))
        ORDER BY i.created_at,i.id LIMIT 1 FOR UPDATE OF i SKIP LOCKED
      ) UPDATE channel_inbound_messages i SET status = 'processing', processing_token = $2, processing_started_at = clock_timestamp(),
        lease_expires_at = clock_timestamp() + ($3 * INTERVAL '1 second'), next_attempt_at = NULL,
        context_fingerprint = COALESCE(i.context_fingerprint,(SELECT md5(row_to_json(conversation)::text)
          FROM search_conversations conversation JOIN customers customer ON customer.id=conversation.customer_id
          WHERE customer.phone_e164=i.phone_e164 AND conversation.status='active' AND conversation.expires_at>clock_timestamp()),'none'),
        attempt_count = attempt_count + 1, total_attempts = total_attempts + 1
      FROM candidate c WHERE i.id = c.id RETURNING ${columns.split(',').map(c => `i.${c.trim()}`).join(', ')}`,
      [id, token, leaseSeconds, allowContextual, INBOX_MAX_ATTEMPTS],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async markProcessedAndCreateOutbound(input: MarkProcessedInboundMessageWithOutbound) {
    return this.transaction(async (client) => {
      const processed = await client.query<{ id: string }>(
        `UPDATE channel_inbound_messages
         SET status = 'processed', customer_id = $3, conversation_id = $4, search_request_id = $5,
             result = $6::jsonb, error_code = NULL, processing_token = NULL, processing_started_at = NULL,
             processed_at = NOW(), lease_expires_at = NULL, next_attempt_at = NULL,
             recovered_at = CASE WHEN total_attempts > 1 THEN NOW() END
         WHERE id = $1 AND processing_token = $2 AND ${liveInboxLeaseSql}
         RETURNING id`,
        [
          input.id,
          input.processingToken,
          input.customerId,
          input.conversationId,
          input.searchRequestId,
          JSON.stringify(input.result),
        ],
      );
      if (!processed.rows[0]) return null;

      const outbound = await client.query<ChannelOutboundMessageRow>(
        `INSERT INTO channel_outbound_messages (
           channel_inbound_message_id, purpose, provider, recipient_phone_e164, text_content, bilateral_notice_version
         ) VALUES ($1, 'customer_reply', $2, $3, $4, $5)
         ON CONFLICT (channel_inbound_message_id) WHERE channel_inbound_message_id IS NOT NULL DO UPDATE
           SET channel_inbound_message_id = EXCLUDED.channel_inbound_message_id
         RETURNING ${channelOutboundMessageColumns}`,
        [
          input.outbound.channelInboundMessageId,
          input.outbound.provider,
          input.outbound.recipientPhoneE164,
          input.outbound.textContent,
          input.outbound.textContent.includes(BILATERAL_NOTICE) ? BILATERAL_NOTICE_VERSION : null,
        ],
      );
      await associateOutboundMessageMatches(client, outbound.rows[0].id, input.outbound);
      return toChannelOutboundMessageRecord(outbound.rows[0]);
    });
  }

  async markFailed(id: string, processingToken: string, errorCode: string) {
    const code = inboxErrorCode(errorCode);
    const result = await this.execute<{ id: string }>(
      `WITH failed AS (UPDATE channel_inbound_messages
       SET status = 'failed', error_code = $3::text, processing_token = NULL, processing_started_at = NULL, lease_expires_at = NULL,
         recovery_state = CASE WHEN $4 OR attempt_count >= $5 THEN 'quarantined' ELSE 'active' END,
         next_attempt_at = CASE WHEN NOT $4 AND attempt_count < $5 THEN clock_timestamp() + (30 * power(2,GREATEST(attempt_count,1)-1)) * INTERVAL '1 second' END,
         quarantined_at = CASE WHEN $4 OR attempt_count >= $5 THEN clock_timestamp() END,
         recovery_reason = CASE WHEN $4 THEN $3::text WHEN attempt_count >= $5 THEN 'attempts_exhausted' END
       WHERE id = $1 AND processing_token = $2 AND ${liveInboxLeaseSql}
       RETURNING id,recovery_state,recovery_reason,total_attempts), audit AS (
         INSERT INTO channel_inbound_recovery_events(inbound_id,event_key,action,reason)
           SELECT id,'failure_' || total_attempts,'quarantine',recovery_reason FROM failed WHERE recovery_state = 'quarantined'
           ON CONFLICT(inbound_id,event_key) DO NOTHING)
       SELECT id FROM failed`,
      [id, processingToken, code, isInboxPermanent(code), INBOX_MAX_ATTEMPTS],
    );
    return result.rows.length === 1;
  }

  async recordPayloadConflict(id: string, input: ChannelInboundMessageInput) {
    const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    await this.transaction(async db => {
      // Do not rewrite the original payload/result, including a completed result.
      await db.query(`UPDATE channel_inbound_messages SET recovery_state = 'quarantined', quarantined_at = clock_timestamp(),
        recovery_reason = 'payload_conflict', next_attempt_at = NULL WHERE id = $1`, [id]);
      await db.query(`INSERT INTO channel_inbound_recovery_events(inbound_id,event_key,action,reason,evidence_hash)
        VALUES($1,$2,'payload_conflict','payload_conflict',$3) ON CONFLICT(inbound_id,event_key) DO NOTHING`, [id, `payload_${hash}`, hash]);
    });
  }

  async quarantineResult(id: string) {
    await this.transaction(async db => {
      await db.query(`UPDATE channel_inbound_messages SET recovery_state = 'quarantined', quarantined_at = clock_timestamp(),
        recovery_reason = 'channel_message_result_invalid', next_attempt_at = NULL WHERE id = $1`, [id]);
      await db.query(`INSERT INTO channel_inbound_recovery_events(inbound_id,event_key,action,reason)
        VALUES($1,'invalid_result','quarantine','channel_message_result_invalid') ON CONFLICT(inbound_id,event_key) DO NOTHING`, [id]);
    });
  }

  async recordFence(id: string, token: string) {
    // Fingerprint prevents event storms for the same obsolete attempt; token itself never enters audit/logs.
    const hash = createHash("sha256").update(token).digest("hex");
    await this.execute(`INSERT INTO channel_inbound_recovery_events(inbound_id,event_key,action,reason)
      VALUES($1,$2,'fencing_conflict','inbox_fencing_conflict') ON CONFLICT(inbound_id,event_key) DO NOTHING`, [id, `fence_${hash}`]);
  }

  async deferContention(id: string, token: string) {
    await this.execute(`UPDATE channel_inbound_messages SET status='failed',error_code='conversation_processing',
      attempt_count=GREATEST(0,attempt_count-1),total_attempts=GREATEST(0,total_attempts-1),
      next_attempt_at=clock_timestamp()+INTERVAL '5 seconds',processing_token=NULL,processing_started_at=NULL,lease_expires_at=NULL
      WHERE id=$1 AND processing_token=$2 AND ${liveInboxLeaseSql}`, [id,token]);
  }

  async runAtomic<T>(record: ChannelInboundMessageRecord, operation: () => Promise<T>, acknowledgeContextChange = false): Promise<T> {
    return this.transaction(async client => {
      const lock = await client.query(`SELECT id FROM channel_inbound_messages WHERE id = $1 AND processing_token = $2
        AND ${liveInboxLeaseSql} FOR UPDATE`, [record.id,record.processingToken]);
      if (!lock.rows.length) throw new InboxFenceError();
      await client.query("SELECT id FROM customers WHERE phone_e164=$1 FOR NO KEY UPDATE",[record.phoneE164]);
      const current = (await client.query<{fingerprint:string}>(`SELECT COALESCE(${inboxContextSql},'none') AS fingerprint`,[record.phoneE164])).rows[0];
      if (!acknowledgeContextChange && record.contextFingerprint && current.fingerprint !== record.contextFingerprint) throw new InboxContextChangedError();
      // Bounded legacy domain transaction. Nested repositories use this same connection.
      await client.query("SET LOCAL statement_timeout = '20s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '20s'");
      const value = await inDatabaseTransaction(client, operation);
      const finished = await client.query(`SELECT id FROM channel_inbound_messages WHERE id = $1 AND status = 'processed'`, [record.id]);
      if (!finished.rows.length) throw new InboxFenceError();
      return value;
    });
  }
}
