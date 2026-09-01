exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE channel_inbound_message_status AS ENUM ('received', 'processing', 'processed', 'failed');

    CREATE TABLE channel_inbound_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider VARCHAR(63) NOT NULL,
      provider_message_id VARCHAR(255) NOT NULL,
      phone_e164 VARCHAR(32) NOT NULL,
      raw_text TEXT NOT NULL,
      country_code VARCHAR(2) NOT NULL DEFAULT 'BR',
      limit_value INTEGER NOT NULL DEFAULT 3,
      status channel_inbound_message_status NOT NULL DEFAULT 'received',
      customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
      conversation_id UUID REFERENCES search_conversations(id) ON DELETE SET NULL,
      search_request_id UUID REFERENCES search_requests(id) ON DELETE SET NULL,
      result JSONB,
      error_code VARCHAR(120),
      processing_token UUID,
      processing_started_at TIMESTAMPTZ,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(provider, provider_message_id),
      CHECK (provider ~ '^[a-z][a-z0-9_-]{0,62}$'),
      CHECK (country_code ~ '^[A-Z]{2}$'),
      CHECK (limit_value BETWEEN 1 AND 10),
      CHECK (
        (status = 'processing' AND processing_token IS NOT NULL AND processing_started_at IS NOT NULL)
        OR (status <> 'processing' AND processing_token IS NULL AND processing_started_at IS NULL)
      ),
      CHECK (
        (status = 'processed' AND result IS NOT NULL AND processed_at IS NOT NULL)
        OR (status <> 'processed' AND processed_at IS NULL)
      )
    );

    CREATE INDEX channel_inbound_messages_status_processing_idx
      ON channel_inbound_messages(status, processing_started_at);
    CREATE INDEX channel_inbound_messages_customer_id_idx
      ON channel_inbound_messages(customer_id);

    CREATE TRIGGER channel_inbound_messages_set_updated_at
      BEFORE UPDATE ON channel_inbound_messages
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE channel_inbound_messages;
    DROP TYPE channel_inbound_message_status;
  `);
};
