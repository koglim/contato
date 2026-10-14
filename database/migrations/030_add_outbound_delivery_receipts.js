exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE channel_outbound_receipts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      outbound_message_id UUID NOT NULL REFERENCES channel_outbound_messages(id) ON DELETE RESTRICT,
      provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 64),
      provider_message_id TEXT NOT NULL CHECK (length(provider_message_id) BETWEEN 1 AND 255),
      provider_status TEXT NOT NULL CHECK (length(provider_status) BETWEEN 1 AND 64),
      normalized_status TEXT NOT NULL CHECK (normalized_status IN ('accepted', 'delivered', 'read', 'failed', 'unknown')),
      provider_event_at TIMESTAMPTZ NULL,
      provider_error_code TEXT NULL CHECK (provider_error_code IS NULL OR length(provider_error_code) BETWEEN 1 AND 64),
      provider_error_reason TEXT NULL CHECK (provider_error_reason IS NULL OR length(provider_error_reason) BETWEEN 1 AND 500),
      event_fingerprint TEXT NOT NULL UNIQUE CHECK (event_fingerprint ~ '^[a-f0-9]{64}$'),
      received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
    );

    CREATE INDEX channel_outbound_receipts_outbound_id_idx
      ON channel_outbound_receipts(outbound_message_id);

    CREATE INDEX channel_outbound_receipts_provider_msg_id_idx
      ON channel_outbound_receipts(provider, provider_message_id);

    CREATE FUNCTION protect_channel_outbound_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'OUTBOUND_RECEIPT_IMMUTABLE' USING ERRCODE = 'P0030';
    END $$;

    CREATE TRIGGER channel_outbound_receipts_no_update_or_delete
      BEFORE UPDATE OR DELETE ON channel_outbound_receipts
      FOR EACH ROW EXECUTE FUNCTION protect_channel_outbound_receipt();

    CREATE TRIGGER channel_outbound_receipts_no_truncate
      BEFORE TRUNCATE ON channel_outbound_receipts
      FOR EACH STATEMENT EXECUTE FUNCTION protect_channel_outbound_receipt();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    LOCK TABLE channel_outbound_receipts IN ACCESS EXCLUSIVE MODE;

    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM channel_outbound_receipts) THEN
        RAISE EXCEPTION 'OUTBOUND_RECEIPT_ROLLBACK_BLOCKED' USING ERRCODE = 'P0030';
      END IF;
    END $$;

    DROP TABLE channel_outbound_receipts;
    DROP FUNCTION protect_channel_outbound_receipt();
  `);
};
