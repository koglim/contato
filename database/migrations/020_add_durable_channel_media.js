exports.up = pgm => {
  pgm.sql(`
    ALTER TABLE channel_inbound_messages ADD COLUMN media_pending BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE channel_outbound_messages
      ADD COLUMN delivery_held_at TIMESTAMPTZ,
      ADD COLUMN administrative_closed_at TIMESTAMPTZ,
      DROP CONSTRAINT channel_outbound_messages_purpose_context_chk,
      ADD CONSTRAINT channel_outbound_messages_purpose_context_chk CHECK (
        (purpose IN ('customer_reply','professional_reply') AND channel_inbound_message_id IS NOT NULL)
        OR (purpose IN ('professional_contact_notification','customer_contact_update','channel_notice') AND channel_inbound_message_id IS NULL)),
      ADD CONSTRAINT outbound_admin_closed_check CHECK (administrative_closed_at IS NULL OR status='failed');
    UPDATE channel_outbound_messages SET delivery_held_at=COALESCE(processing_started_at,created_at)
      WHERE delivery_hold_reason IS NOT NULL;

    CREATE TABLE channel_media_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      inbound_id UUID NOT NULL UNIQUE REFERENCES channel_inbound_messages(id) ON DELETE RESTRICT,
      event_fingerprint TEXT NOT NULL CHECK (event_fingerprint ~ '^[a-f0-9]{64}$'),
      media_hash TEXT NOT NULL CHECK (media_hash ~ '^[a-f0-9]{64}$'),
      mime_type TEXT NOT NULL CHECK (length(mime_type)<=100),
      duration_seconds DOUBLE PRECISION CHECK (duration_seconds>=0 AND duration_seconds<'Infinity'::float8),
      status TEXT NOT NULL CHECK (status IN ('pending','processing','completed','failed','quarantined')),
      media_bytes BYTEA CHECK (octet_length(media_bytes) BETWEEN 1 AND 3145728),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()+INTERVAL '1 hour',
      purged_at TIMESTAMPTZ,
      purge_reason TEXT CHECK (purge_reason IN ('completed','retention','invalid','quarantined')),
      processing_token UUID, lease_expires_at TIMESTAMPTZ,
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
      transcript TEXT CHECK (length(transcript) BETWEEN 1 AND 500),
      transcription_provider TEXT CHECK (transcription_provider IN ('groq','openai')),
      result_token_hash TEXT CHECK (result_token_hash ~ '^[a-f0-9]{64}$'),
      last_error_code TEXT CHECK (last_error_code ~ '^[a-z][a-z0-9_]{0,79}$'),
      notice_outbound_id UUID UNIQUE REFERENCES channel_outbound_messages(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), completed_at TIMESTAMPTZ,
      CHECK ((status='processing') = (processing_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
      CHECK ((transcript IS NULL) = (transcription_provider IS NULL)),
      CHECK (media_bytes IS NULL OR (status IN ('pending','processing') AND mime_type IN ('audio/ogg','audio/mpeg','audio/mp4','audio/wav','audio/webm'))),
      CHECK (status NOT IN ('pending','processing') OR media_bytes IS NOT NULL)
    );
    CREATE INDEX channel_media_queue_idx ON channel_media_events(created_at,id) WHERE status IN ('pending','processing');
    CREATE INDEX channel_media_retention_idx ON channel_media_events(expires_at) WHERE media_bytes IS NOT NULL;
    CREATE TABLE channel_transport_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      outbound_id UUID REFERENCES channel_outbound_messages(id) ON DELETE RESTRICT,
      media_id UUID REFERENCES channel_media_events(id) ON DELETE RESTRICT,
      event_key TEXT NOT NULL CHECK (length(event_key) BETWEEN 1 AND 150),
      action TEXT NOT NULL CHECK (action IN ('confirm','retry','close','retain','conflict','transcript_conflict','payload_conflict','hold','media_claim')),
      reason TEXT NOT NULL CHECK (reason ~ '^[a-z][a-z0-9_]{0,79}$'),
      operator_id UUID,
      payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
      evidence_hash TEXT CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
      provider_message_id TEXT CHECK (length(provider_message_id) BETWEEN 1 AND 255),
      result JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      CHECK ((outbound_id IS NULL) <> (media_id IS NULL)),
      UNIQUE(outbound_id,event_key), UNIQUE(media_id,event_key)
    );
    CREATE FUNCTION protect_transport_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'TRANSPORT_EVENT_IMMUTABLE' USING ERRCODE='P0020'; END;
    $$;
    CREATE TRIGGER transport_event_immutable BEFORE UPDATE OR DELETE ON channel_transport_events
      FOR EACH ROW EXECUTE FUNCTION protect_transport_event();
  `);
};

exports.down = pgm => {
  pgm.sql(`
    LOCK TABLE channel_media_events,channel_transport_events,channel_inbound_messages,channel_outbound_messages IN ACCESS EXCLUSIVE MODE;
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM channel_media_events) OR EXISTS(SELECT 1 FROM channel_transport_events)
        OR EXISTS(SELECT 1 FROM channel_inbound_messages WHERE media_pending)
        OR EXISTS(SELECT 1 FROM channel_outbound_messages WHERE purpose='channel_notice' OR administrative_closed_at IS NOT NULL)
      THEN RAISE EXCEPTION 'DURABLE_MEDIA_ROLLBACK_BLOCKED' USING ERRCODE='P0020'; END IF;
    END $$;
    DROP TABLE channel_transport_events;
    DROP FUNCTION protect_transport_event();
    DROP TABLE channel_media_events;
    ALTER TABLE channel_inbound_messages DROP COLUMN media_pending;
    ALTER TABLE channel_outbound_messages DROP COLUMN delivery_held_at, DROP COLUMN administrative_closed_at,
      DROP CONSTRAINT channel_outbound_messages_purpose_context_chk,
      ADD CONSTRAINT channel_outbound_messages_purpose_context_chk CHECK (
        (purpose IN ('customer_reply','professional_reply') AND channel_inbound_message_id IS NOT NULL)
        OR (purpose IN ('professional_contact_notification','customer_contact_update') AND channel_inbound_message_id IS NULL));
  `);
};
