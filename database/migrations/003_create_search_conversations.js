exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE search_conversation_status AS ENUM ('active', 'completed', 'cancelled', 'expired');
    CREATE TYPE search_conversation_pending_slot AS ENUM ('location');

    CREATE TABLE search_conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
      status search_conversation_status NOT NULL DEFAULT 'active',
      pending_slot search_conversation_pending_slot,
      original_raw_text TEXT NOT NULL,
      service_text TEXT NOT NULL,
      country_code VARCHAR(2) NOT NULL DEFAULT 'BR',
      limit_value INTEGER NOT NULL DEFAULT 3,
      last_message_text TEXT,
      search_request_id UUID REFERENCES search_requests(id) ON DELETE SET NULL,
      processing_token UUID,
      processing_started_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      CHECK (country_code ~ '^[A-Z]{2}$'),
      CHECK (limit_value BETWEEN 1 AND 10),
      CHECK (
        (status = 'active' AND pending_slot = 'location')
        OR (status <> 'active' AND pending_slot IS NULL)
      ),
      CHECK (
        (processing_token IS NULL AND processing_started_at IS NULL)
        OR (status = 'active' AND processing_token IS NOT NULL AND processing_started_at IS NOT NULL)
      ),
      CHECK (
        (status = 'completed' AND completed_at IS NOT NULL)
        OR (status <> 'completed' AND completed_at IS NULL)
      ),
      CHECK (search_request_id IS NULL OR status = 'completed')
    );

    CREATE INDEX search_conversations_status_expires_at_idx ON search_conversations(status, expires_at);
    CREATE INDEX search_conversations_customer_id_idx ON search_conversations(customer_id);

    CREATE TRIGGER search_conversations_set_updated_at
      BEFORE UPDATE ON search_conversations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE search_conversations;
    DROP TYPE search_conversation_pending_slot;
    DROP TYPE search_conversation_status;
  `);
};
