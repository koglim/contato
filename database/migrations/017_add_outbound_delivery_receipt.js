exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE channel_outbound_messages
      ADD COLUMN sent_token_hash TEXT NULL,
      ADD COLUMN delivery_hold_reason TEXT NULL,
      ADD CONSTRAINT outbound_sent_receipt_check CHECK (
        sent_token_hash IS NULL OR (status = 'sent' AND sent_token_hash ~ '^[0-9a-f]{64}$')
      ),
      ADD CONSTRAINT outbound_delivery_hold_check CHECK (
        delivery_hold_reason IS NULL OR
        (status = 'processing' AND delivery_hold_reason IN ('transport_outcome_unknown', 'confirmation_pending'))
      );
    CREATE INDEX channel_outbound_recipient_queue_idx
      ON channel_outbound_messages(provider, recipient_phone_e164, created_at, id)
      WHERE status <> 'sent';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    LOCK TABLE channel_outbound_messages IN ACCESS EXCLUSIVE MODE;
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM channel_outbound_messages
        WHERE sent_token_hash IS NOT NULL OR delivery_hold_reason IS NOT NULL) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0017', MESSAGE = 'OUTBOUND_RECEIPT_ROLLBACK_BLOCKED';
      END IF;
    END $$;
    DROP INDEX channel_outbound_recipient_queue_idx;
    ALTER TABLE channel_outbound_messages
      DROP CONSTRAINT outbound_sent_receipt_check,
      DROP CONSTRAINT outbound_delivery_hold_check,
      DROP COLUMN sent_token_hash,
      DROP COLUMN delivery_hold_reason;
  `);
};
