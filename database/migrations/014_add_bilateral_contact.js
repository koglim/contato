exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE contacts
      ADD COLUMN public_code TEXT,
      ADD COLUMN bilateral_snapshot JSONB,
      ADD COLUMN selection_conversation_id UUID REFERENCES search_conversations(id) ON DELETE RESTRICT,
      ADD CONSTRAINT contacts_public_code_format CHECK (public_code IS NULL OR public_code ~ '^CC-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$'),
      ADD CONSTRAINT contacts_bilateral_complete CHECK (
        (public_code IS NULL AND bilateral_snapshot IS NULL AND selection_conversation_id IS NULL)
        OR (public_code IS NOT NULL AND bilateral_snapshot IS NOT NULL
          AND selection_conversation_id IS NOT NULL AND selection_key IS NOT NULL
          AND customer_id IS NOT NULL AND jsonb_typeof(bilateral_snapshot) = 'object')
      );
    CREATE UNIQUE INDEX contacts_public_code_unique_idx ON contacts (lower(public_code)) WHERE public_code IS NOT NULL;
    CREATE UNIQUE INDEX contacts_bilateral_search_unique_idx ON contacts (search_request_id) WHERE bilateral_snapshot IS NOT NULL;

    ALTER TABLE channel_outbound_messages
      ADD COLUMN business_key TEXT,
      ADD COLUMN bilateral_notice_version TEXT,
      ADD CONSTRAINT outbound_business_key_format CHECK (business_key IS NULL OR length(business_key) BETWEEN 1 AND 120);
    CREATE UNIQUE INDEX outbound_business_key_unique_idx ON channel_outbound_messages (business_key) WHERE business_key IS NOT NULL;

    -- NULL means no recorded notice/consent, never consent inferred by migration.
    ALTER TABLE search_conversations ADD COLUMN bilateral_pending JSONB
      CHECK (bilateral_pending IS NULL OR jsonb_typeof(bilateral_pending) = 'object');
    ALTER TABLE channel_inbound_messages ADD COLUMN bilateral_response JSONB
      CHECK (bilateral_response IS NULL OR jsonb_typeof(bilateral_response) = 'object');

    CREATE FUNCTION protect_bilateral_contact_snapshot() RETURNS trigger AS $$
    BEGIN
      IF OLD.bilateral_snapshot IS NOT NULL AND (
        NEW.bilateral_snapshot IS DISTINCT FROM OLD.bilateral_snapshot
        OR NEW.public_code IS DISTINCT FROM OLD.public_code
        OR NEW.selection_key IS DISTINCT FROM OLD.selection_key
        OR NEW.selection_conversation_id IS DISTINCT FROM OLD.selection_conversation_id
        OR NEW.search_request_id IS DISTINCT FROM OLD.search_request_id
        OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
        OR NEW.professional_id IS DISTINCT FROM OLD.professional_id
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Bilateral opportunity identity and snapshot are immutable';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER contacts_protect_bilateral_snapshot BEFORE UPDATE ON contacts
      FOR EACH ROW EXECUTE FUNCTION protect_bilateral_contact_snapshot();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Operational barrier, BEFORE all DDL/DML. Locks prevent a concurrent writer
    -- from creating incompatible data between the preflight and schema removal.
    -- Also protects the data that historical migrations 010/012 cannot retain.
    LOCK TABLE contacts, channel_outbound_messages, search_conversations,
      channel_inbound_messages IN ACCESS EXCLUSIVE MODE;
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM contacts WHERE selection_key IS NOT NULL
          OR public_code IS NOT NULL OR bilateral_snapshot IS NOT NULL OR selection_conversation_id IS NOT NULL)
        OR EXISTS (SELECT 1 FROM channel_outbound_messages WHERE channel_inbound_message_id IS NULL
          OR business_key IS NOT NULL OR bilateral_notice_version IS NOT NULL)
        OR EXISTS (SELECT 1 FROM search_conversations WHERE bilateral_pending IS NOT NULL)
        OR EXISTS (SELECT 1 FROM channel_inbound_messages WHERE bilateral_response IS NOT NULL)
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0014',
          MESSAGE = 'BILATERAL_ROLLBACK_BLOCKED: protected contact, consent, notice, independent notification or idempotency data exists.',
          HINT = 'Use a forward corrective migration (roll-forward), or restore a complete verified backup. Do not delete business data to bypass this barrier.';
      END IF;
    END;
    $$;
    DROP TRIGGER contacts_protect_bilateral_snapshot ON contacts;
    DROP FUNCTION protect_bilateral_contact_snapshot();
    DROP INDEX contacts_public_code_unique_idx;
    DROP INDEX contacts_bilateral_search_unique_idx;
    ALTER TABLE contacts DROP CONSTRAINT contacts_bilateral_complete,
      DROP CONSTRAINT contacts_public_code_format, DROP COLUMN public_code,
      DROP COLUMN bilateral_snapshot, DROP COLUMN selection_conversation_id;
    DROP INDEX outbound_business_key_unique_idx;
    ALTER TABLE channel_outbound_messages DROP CONSTRAINT outbound_business_key_format,
      DROP COLUMN business_key, DROP COLUMN bilateral_notice_version;
    ALTER TABLE search_conversations DROP COLUMN bilateral_pending;
    ALTER TABLE channel_inbound_messages DROP COLUMN bilateral_response;
  `);
};
