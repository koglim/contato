exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE channel_inbound_messages
      ADD COLUMN recovery_state TEXT NOT NULL DEFAULT 'active' CHECK (recovery_state IN ('active','quarantined','closed')),
      ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
      ADD COLUMN total_attempts INTEGER NOT NULL DEFAULT 0 CHECK (total_attempts >= attempt_count),
      ADD COLUMN next_attempt_at TIMESTAMPTZ,
      ADD COLUMN lease_expires_at TIMESTAMPTZ,
      ADD COLUMN quarantined_at TIMESTAMPTZ,
      ADD COLUMN recovery_reason TEXT CHECK (recovery_reason ~ '^[a-z][a-z0-9_]{0,79}$'),
      ADD COLUMN recovered_at TIMESTAMPTZ,
      ADD COLUMN context_fingerprint TEXT,
      ADD CONSTRAINT inbound_recovery_state_check CHECK (
        (recovery_state = 'active' AND quarantined_at IS NULL)
        OR (recovery_state IN ('quarantined','closed') AND quarantined_at IS NOT NULL AND recovery_reason IS NOT NULL)),
      ADD CONSTRAINT inbound_recovery_schedule_check CHECK (next_attempt_at IS NULL OR (status = 'failed' AND recovery_state = 'active'));

    CREATE TABLE channel_inbound_recovery_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      inbound_id UUID NOT NULL REFERENCES channel_inbound_messages(id) ON DELETE RESTRICT,
      event_key TEXT NOT NULL CHECK (length(event_key) BETWEEN 1 AND 100),
      action TEXT NOT NULL CHECK (action IN ('quarantine','retry','close','fencing_conflict','payload_conflict')),
      reason TEXT NOT NULL CHECK (reason ~ '^[a-z][a-z0-9_]{0,79}$'),
      operator_id UUID,
      evidence_hash TEXT CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(inbound_id, event_key)
    );
    CREATE FUNCTION protect_inbound_recovery_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'INBOX_RECOVERY_EVENT_IMMUTABLE' USING ERRCODE = 'P0019'; END;
    $$;
    CREATE TRIGGER inbound_recovery_event_immutable BEFORE UPDATE ON channel_inbound_recovery_events
      FOR EACH ROW EXECUTE FUNCTION protect_inbound_recovery_event();

    -- Pre-019 non-contextual processing could have committed partial domain effects.
    -- Preserve these entries for explicit reconciliation, never blindly run them again.
    UPDATE channel_inbound_messages SET recovery_state = 'quarantined', quarantined_at = NOW(),
      recovery_reason = 'legacy_effects_uncertain', status = 'failed', processing_token = NULL, processing_started_at = NULL
      WHERE status IN ('processing','failed') AND NOT contextual_queue;
    INSERT INTO channel_inbound_recovery_events(inbound_id,event_key,action,reason)
      SELECT id,'migration_019','quarantine','legacy_effects_uncertain' FROM channel_inbound_messages
      WHERE recovery_reason = 'legacy_effects_uncertain';

    CREATE INDEX channel_inbound_recovery_queue_idx ON channel_inbound_messages(created_at,id)
      WHERE status <> 'processed' AND recovery_state = 'active';
    CREATE INDEX channel_inbound_recovery_phone_idx ON channel_inbound_messages(phone_e164,created_at,id)
      WHERE (status <> 'processed' OR recovery_state = 'quarantined') AND recovery_state <> 'closed';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    LOCK TABLE channel_inbound_messages, channel_inbound_recovery_events IN ACCESS EXCLUSIVE MODE;
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM channel_inbound_recovery_events)
        OR EXISTS (SELECT 1 FROM channel_inbound_messages WHERE recovery_state <> 'active'
          OR next_attempt_at IS NOT NULL OR (status <> 'processed' AND total_attempts > 0)) THEN
        RAISE EXCEPTION 'INBOX_RECOVERY_ROLLBACK_BLOCKED' USING ERRCODE = 'P0019';
      END IF;
    END $$;
    DROP TABLE channel_inbound_recovery_events;
    DROP FUNCTION protect_inbound_recovery_event();
    DROP INDEX channel_inbound_recovery_queue_idx;
    DROP INDEX channel_inbound_recovery_phone_idx;
    ALTER TABLE channel_inbound_messages DROP CONSTRAINT inbound_recovery_state_check,
      DROP CONSTRAINT inbound_recovery_schedule_check, DROP COLUMN recovery_state,
      DROP COLUMN attempt_count, DROP COLUMN total_attempts, DROP COLUMN next_attempt_at,
      DROP COLUMN lease_expires_at, DROP COLUMN quarantined_at, DROP COLUMN recovery_reason, DROP COLUMN recovered_at,
      DROP COLUMN context_fingerprint;
  `);
};
