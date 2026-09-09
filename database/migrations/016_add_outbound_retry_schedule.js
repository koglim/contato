exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE channel_outbound_messages
      ADD COLUMN next_attempt_at TIMESTAMPTZ NULL;

    CREATE INDEX channel_outbound_messages_pending_next_attempt_idx
      ON channel_outbound_messages(next_attempt_at, created_at, id)
      WHERE status = 'pending';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    LOCK TABLE channel_outbound_messages IN ACCESS EXCLUSIVE MODE;
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM channel_outbound_messages WHERE next_attempt_at IS NOT NULL
      ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0016', MESSAGE = 'OUTBOUND_RETRY_ROLLBACK_BLOCKED';
      END IF;
    END $$;
    DROP INDEX IF EXISTS channel_outbound_messages_pending_next_attempt_idx;
    ALTER TABLE channel_outbound_messages DROP COLUMN next_attempt_at;
  `);
};
