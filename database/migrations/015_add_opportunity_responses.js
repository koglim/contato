exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE search_conversations ADD COLUMN resume_slot TEXT
      CHECK (resume_slot IS NULL OR resume_slot IN ('location', 'service', 'selection'));
    ALTER TABLE search_conversations ADD COLUMN resume_code TEXT UNIQUE
      CHECK (resume_code IS NULL OR resume_code ~ '^CC-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$');
    CREATE TABLE opportunity_response_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
      professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE RESTRICT,
      inbound_id UUID NOT NULL UNIQUE REFERENCES channel_inbound_messages(id) ON DELETE RESTRICT,
      previous_state TEXT NOT NULL CHECK (previous_state = 'requested'),
      next_state TEXT NOT NULL CHECK (next_state IN ('accepted', 'declined')),
      origin TEXT NOT NULL CHECK (origin = 'channel_inbox'),
      rule_version TEXT NOT NULL CHECK (length(rule_version) BETWEEN 1 AND 60),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (contact_id)
    );
    CREATE FUNCTION protect_opportunity_event() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Opportunity events are append-only';
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER opportunity_event_immutable BEFORE UPDATE OR DELETE ON opportunity_response_events
      FOR EACH ROW EXECUTE FUNCTION protect_opportunity_event();
    ALTER TABLE channel_outbound_messages ADD COLUMN opportunity_event_id UUID
      REFERENCES opportunity_response_events(id) ON DELETE RESTRICT;
    ALTER TABLE channel_inbound_messages ADD COLUMN response_outbound_id UUID REFERENCES channel_outbound_messages(id) ON DELETE RESTRICT;
    DROP INDEX contacts_bilateral_search_unique_idx;
    CREATE UNIQUE INDEX contacts_bilateral_search_unique_idx ON contacts(search_request_id)
      WHERE bilateral_snapshot IS NOT NULL AND status <> 'declined';
    ALTER TABLE channel_outbound_messages DROP CONSTRAINT channel_outbound_messages_purpose_context_chk,
      ALTER COLUMN purpose DROP DEFAULT,
      ALTER COLUMN purpose TYPE TEXT USING purpose::text,
      ALTER COLUMN purpose SET DEFAULT 'customer_reply';
    ALTER TABLE channel_outbound_messages ADD CONSTRAINT channel_outbound_messages_purpose_context_chk CHECK (
      (purpose IN ('customer_reply', 'professional_reply') AND channel_inbound_message_id IS NOT NULL)
      OR (purpose IN ('professional_contact_notification', 'customer_contact_update') AND channel_inbound_message_id IS NULL)
    );
    CREATE INDEX contacts_pending_professional_idx ON contacts(professional_id, created_at)
      WHERE bilateral_snapshot IS NOT NULL AND status = 'requested';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    LOCK TABLE contacts, opportunity_response_events, channel_outbound_messages, search_conversations, channel_inbound_messages IN ACCESS EXCLUSIVE MODE;
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM opportunity_response_events)
        OR EXISTS (SELECT 1 FROM channel_inbound_messages WHERE response_outbound_id IS NOT NULL)
        OR EXISTS (SELECT 1 FROM search_conversations WHERE resume_slot IS NOT NULL OR resume_code IS NOT NULL)
        OR EXISTS (SELECT 1 FROM channel_outbound_messages WHERE purpose IN ('professional_reply', 'customer_contact_update'))
        OR EXISTS (SELECT 1 FROM contacts WHERE bilateral_snapshot IS NOT NULL GROUP BY search_request_id HAVING count(*) > 1)
      THEN RAISE EXCEPTION USING ERRCODE = 'P0015', MESSAGE = 'OPPORTUNITY_RESPONSE_ROLLBACK_BLOCKED';
      END IF;
    END $$;
    ALTER TABLE channel_inbound_messages DROP COLUMN response_outbound_id;
    ALTER TABLE channel_outbound_messages DROP COLUMN opportunity_event_id,
      DROP CONSTRAINT channel_outbound_messages_purpose_context_chk, ALTER COLUMN purpose DROP DEFAULT,
      ALTER COLUMN purpose TYPE channel_outbound_message_purpose USING purpose::channel_outbound_message_purpose,
      ALTER COLUMN purpose SET DEFAULT 'customer_reply';
    ALTER TABLE channel_outbound_messages ADD CONSTRAINT channel_outbound_messages_purpose_context_chk CHECK (
      (purpose = 'customer_reply' AND channel_inbound_message_id IS NOT NULL)
      OR (purpose = 'professional_contact_notification' AND channel_inbound_message_id IS NULL)
    );
    DROP TABLE opportunity_response_events;
    DROP FUNCTION protect_opportunity_event();
    DROP INDEX contacts_pending_professional_idx;
    DROP INDEX contacts_bilateral_search_unique_idx;
    CREATE UNIQUE INDEX contacts_bilateral_search_unique_idx ON contacts(search_request_id) WHERE bilateral_snapshot IS NOT NULL;
    ALTER TABLE search_conversations DROP COLUMN resume_slot, DROP COLUMN resume_code;
  `);
};
