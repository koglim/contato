exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE channel_outbound_message_status AS ENUM ('pending', 'processing', 'sent', 'failed');

    CREATE TABLE channel_outbound_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      channel_inbound_message_id UUID NOT NULL UNIQUE
        REFERENCES channel_inbound_messages(id) ON DELETE CASCADE,
      provider VARCHAR(63) NOT NULL,
      recipient_phone_e164 VARCHAR(32) NOT NULL,
      message_type VARCHAR(32) NOT NULL DEFAULT 'text',
      text_content TEXT NOT NULL,
      status channel_outbound_message_status NOT NULL DEFAULT 'pending',
      processing_token UUID,
      processing_started_at TIMESTAMPTZ,
      provider_message_id VARCHAR(255),
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error_code VARCHAR(120),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMPTZ,
      CHECK (provider ~ '^[a-z][a-z0-9_-]{0,62}$'),
      CHECK (recipient_phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
      CHECK (message_type = 'text'),
      CHECK (length(text_content) BETWEEN 1 AND 2000),
      CHECK (attempt_count >= 0),
      CHECK (
        (status = 'processing' AND processing_token IS NOT NULL AND processing_started_at IS NOT NULL)
        OR (status <> 'processing' AND processing_token IS NULL AND processing_started_at IS NULL)
      ),
      CHECK (
        (status = 'sent' AND provider_message_id IS NOT NULL AND sent_at IS NOT NULL)
        OR (status <> 'sent' AND sent_at IS NULL)
      )
    );

    CREATE INDEX channel_outbound_messages_status_processing_idx
      ON channel_outbound_messages(status, processing_started_at);

    CREATE TRIGGER channel_outbound_messages_set_updated_at
      BEFORE UPDATE ON channel_outbound_messages
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE channel_outbound_messages;
    DROP TYPE channel_outbound_message_status;
  `);
};
