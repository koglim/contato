import type { QueryResultRow } from "pg";
import { query, type SqlValue } from "../../database/connection.js";
import type {
  ChannelOutboundMessageRecord,
  ChannelOutboundMessageRepository,
} from "./channel-outbox.types.js";
import type { ChannelOutboundMessageStatus, MarkChannelOutboundMessageFailedInput, MarkChannelOutboundMessageSentInput } from "@contatocerto/shared";

export type ChannelOutboundMessageRow = {
  id: string;
  channel_inbound_message_id: string;
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
};

export type ChannelOutboxQuery = <T extends QueryResultRow>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>;

export const channelOutboundMessageColumns = `
  id, channel_inbound_message_id, provider, recipient_phone_e164, message_type, text_content,
  status, processing_token, processing_started_at, provider_message_id, attempt_count, last_error_code, sent_at
`;

export function toChannelOutboundMessageRecord(row: ChannelOutboundMessageRow): ChannelOutboundMessageRecord {
  return {
    id: row.id,
    channelInboundMessageId: row.channel_inbound_message_id,
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
  };
}

const defaultQuery: ChannelOutboxQuery = (text, values = []) => query(text, values as SqlValue[]);

export class PostgresChannelOutboundMessageRepository implements ChannelOutboundMessageRepository {
  constructor(private readonly execute: ChannelOutboxQuery = defaultQuery) {}

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

  async claim(id: string, processingToken: string, processingLeaseSeconds: number) {
    const result = await this.execute<ChannelOutboundMessageRow>(
      `UPDATE channel_outbound_messages
       SET status = 'processing', processing_token = $2, processing_started_at = NOW(), attempt_count = attempt_count + 1
       WHERE id = $1
         AND (
           status IN ('pending', 'failed')
           OR (status = 'processing' AND processing_started_at <= NOW() - ($3 * INTERVAL '1 second'))
         )
       RETURNING ${channelOutboundMessageColumns}`,
      [id, processingToken, processingLeaseSeconds],
    );
    return result.rows[0] ? toChannelOutboundMessageRecord(result.rows[0]) : null;
  }

  async markSent(id: string, input: MarkChannelOutboundMessageSentInput) {
    const result = await this.execute<{ id: string }>(
      `UPDATE channel_outbound_messages
       SET status = 'sent', provider_message_id = $3, sent_at = NOW(), processing_token = NULL,
           processing_started_at = NULL, last_error_code = NULL
       WHERE id = $1 AND status = 'processing' AND processing_token = $2
       RETURNING id`,
      [id, input.processing_token, input.provider_message_id],
    );
    return result.rows.length === 1;
  }

  async markFailed(id: string, input: MarkChannelOutboundMessageFailedInput) {
    const result = await this.execute<{ id: string }>(
      `UPDATE channel_outbound_messages
       SET status = 'failed', last_error_code = $3, processing_token = NULL, processing_started_at = NULL
       WHERE id = $1 AND status = 'processing' AND processing_token = $2
       RETURNING id`,
      [id, input.processing_token, input.error_code],
    );
    return result.rows.length === 1;
  }
}
