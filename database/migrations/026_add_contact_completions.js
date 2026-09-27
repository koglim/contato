exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE contact_completions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id UUID NOT NULL UNIQUE REFERENCES contacts(id) ON DELETE RESTRICT,
      state TEXT NOT NULL CHECK (state IN ('pending_confirmation', 'confirmed', 'contested')),
      declared_by TEXT NOT NULL CHECK (declared_by IN ('customer', 'professional')),
      declared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      confirmed_at TIMESTAMPTZ,
      contested_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT check_completion_state_timestamps CHECK (
        (state = 'pending_confirmation' AND confirmed_at IS NULL AND contested_at IS NULL)
        OR (state = 'confirmed' AND confirmed_at IS NOT NULL AND contested_at IS NULL)
        OR (state = 'contested' AND contested_at IS NOT NULL AND confirmed_at IS NULL)
      )
    );

    CREATE TRIGGER contact_completions_updated_at BEFORE UPDATE ON contact_completions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE contact_completion_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      completion_id UUID NOT NULL REFERENCES contact_completions(id) ON DELETE RESTRICT,
      contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
      actor_role TEXT NOT NULL CHECK (actor_role IN ('customer', 'professional')),
      action TEXT NOT NULL CHECK (action IN ('declared', 'confirmed', 'contested')),
      inbound_message_id UUID NOT NULL REFERENCES channel_inbound_messages(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX contact_completion_events_completion_idx
      ON contact_completion_events(completion_id, created_at, id);
    CREATE INDEX contact_completion_events_contact_idx
      ON contact_completion_events(contact_id, created_at, id);
    CREATE INDEX contact_completion_events_inbound_idx
      ON contact_completion_events(inbound_message_id);

    CREATE FUNCTION protect_contact_completion_events() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'CONTACT_COMPLETION_EVENT_IMMUTABLE' USING ERRCODE = 'P0026';
    END $$;

    CREATE TRIGGER contact_completion_events_immutable BEFORE UPDATE OR DELETE ON contact_completion_events
      FOR EACH ROW EXECUTE FUNCTION protect_contact_completion_events();
    CREATE TRIGGER contact_completion_events_no_truncate BEFORE TRUNCATE ON contact_completion_events
      FOR EACH STATEMENT EXECUTE FUNCTION protect_contact_completion_events();

    ALTER TABLE channel_outbound_messages
      ADD COLUMN completion_event_id UUID REFERENCES contact_completion_events(id) ON DELETE RESTRICT;

    CREATE INDEX channel_outbound_messages_completion_event_idx
      ON channel_outbound_messages(completion_event_id)
      WHERE completion_event_id IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    LOCK TABLE contacts, contact_completions, contact_completion_events, channel_outbound_messages IN ACCESS EXCLUSIVE MODE;
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM contact_completions)
         OR EXISTS (SELECT 1 FROM contact_completion_events)
         OR EXISTS (SELECT 1 FROM channel_outbound_messages WHERE completion_event_id IS NOT NULL)
      THEN
        RAISE EXCEPTION 'CONTACT_COMPLETION_ROLLBACK_BLOCKED' USING ERRCODE = 'P0026';
      END IF;
    END $$;

    DROP INDEX IF EXISTS channel_outbound_messages_completion_event_idx;
    ALTER TABLE channel_outbound_messages DROP COLUMN completion_event_id;
    DROP TRIGGER contact_completion_events_no_truncate ON contact_completion_events;
    DROP TRIGGER contact_completion_events_immutable ON contact_completion_events;
    DROP FUNCTION protect_contact_completion_events();
    DROP TABLE contact_completion_events;
    DROP TABLE contact_completions;
  `);
};
