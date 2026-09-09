import type { QueryResultRow } from "pg";
import { BILATERAL_NOTICE, BILATERAL_NOTICE_VERSION } from "../bilateral-contact/bilateral-contact.policy.js";
import { query, withTransaction, type DatabaseClient, type SqlValue } from "../../database/connection.js";
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
};

export type ChannelInboxQuery = <T extends QueryResultRow>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>;
export type ChannelInboxTransaction = <T>(callback: (client: DatabaseClient) => Promise<T>) => Promise<T>;

const columns = `
  id, provider, provider_message_id, phone_e164, raw_text, country_code, limit_value,
  status, customer_id, conversation_id, search_request_id,
  result, error_code, processing_token, processing_started_at
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
  };
}

const defaultQuery: ChannelInboxQuery = (text, values = []) => query(text, values as SqlValue[]);

export class PostgresChannelInboundMessageRepository implements ChannelInboundMessageRepository {
  constructor(
    private readonly execute: ChannelInboxQuery = defaultQuery,
    private readonly transaction: ChannelInboxTransaction = withTransaction,
  ) {}

  async createOrFind(input: ChannelInboundMessageInput) {
    const inserted = await this.execute<ChannelInboundMessageRow>(
      `INSERT INTO channel_inbound_messages (
         provider, provider_message_id, phone_e164, raw_text, country_code, limit_value
       ) VALUES ($1, $2, $3, $4, $5, $6)
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
    const result = await this.execute<ChannelInboundMessageRow>(
      `UPDATE channel_inbound_messages
       SET status = 'processing', processing_token = $2, processing_started_at = NOW(), error_code = NULL
       WHERE id = $1
         AND (
           status IN ('received', 'failed')
           OR (status = 'processing' AND processing_started_at <= NOW() - ($3 * INTERVAL '1 second'))
         )
       RETURNING ${columns}`,
      [id, processingToken, processingLeaseSeconds],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async markProcessedAndCreateOutbound(input: MarkProcessedInboundMessageWithOutbound) {
    return this.transaction(async (client) => {
      const processed = await client.query<{ id: string }>(
        `UPDATE channel_inbound_messages
         SET status = 'processed', customer_id = $3, conversation_id = $4, search_request_id = $5,
             result = $6::jsonb, error_code = NULL, processing_token = NULL, processing_started_at = NULL,
             processed_at = NOW()
         WHERE id = $1 AND status = 'processing' AND processing_token = $2
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
    const result = await this.execute<{ id: string }>(
      `UPDATE channel_inbound_messages
       SET status = 'failed', error_code = $3, processing_token = NULL, processing_started_at = NULL
       WHERE id = $1 AND status = 'processing' AND processing_token = $2
       RETURNING id`,
      [id, processingToken, errorCode],
    );
    return result.rows.length === 1;
  }
}
