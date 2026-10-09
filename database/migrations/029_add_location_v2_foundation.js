exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Support structured coordinates in channel_inbound_messages
    ALTER TABLE channel_inbound_messages
      ALTER COLUMN raw_text DROP NOT NULL;

    ALTER TABLE channel_inbound_messages
      ADD COLUMN latitude DOUBLE PRECISION NULL,
      ADD COLUMN longitude DOUBLE PRECISION NULL,
      ADD COLUMN location_name VARCHAR(200) NULL;

    ALTER TABLE channel_inbound_messages
      ADD CONSTRAINT channel_inbound_messages_payload_presence_chk
      CHECK (
        (raw_text IS NOT NULL)
        OR (latitude IS NOT NULL AND longitude IS NOT NULL)
      );

    ALTER TABLE channel_inbound_messages
      ADD CONSTRAINT channel_inbound_messages_coords_chk
      CHECK (
        (latitude IS NULL AND longitude IS NULL)
        OR (
          latitude IS NOT NULL
          AND longitude IS NOT NULL
          AND latitude BETWEEN -90 AND 90
          AND longitude BETWEEN -180 AND 180
        )
      );

    -- 2. Update search_conversations pending_slot enum and constraints for location_confirmation
    DO $$
    DECLARE
      constraint_record RECORD;
    BEGIN
      FOR constraint_record IN
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = 'search_conversations'::regclass
           AND contype = 'c'
           AND (
             pg_get_constraintdef(oid) LIKE '%pending_slot%'
             OR pg_get_constraintdef(oid) LIKE '%search_request_id%'
             OR pg_get_constraintdef(oid) LIKE '%resume_slot%'
           )
      LOOP
        EXECUTE format('ALTER TABLE search_conversations DROP CONSTRAINT %I', constraint_record.conname);
      END LOOP;
    END
    $$;

    ALTER TYPE search_conversation_pending_slot RENAME TO search_conversation_pending_slot_old;
    CREATE TYPE search_conversation_pending_slot AS ENUM ('location', 'service', 'selection', 'location_confirmation');
    ALTER TABLE search_conversations
      ALTER COLUMN pending_slot TYPE search_conversation_pending_slot
      USING pending_slot::TEXT::search_conversation_pending_slot;
    DROP TYPE search_conversation_pending_slot_old;

    ALTER TABLE search_conversations
      ADD CONSTRAINT search_conversations_status_pending_slot_check CHECK (
        (status = 'active' AND pending_slot IS NOT NULL)
        OR (status <> 'active' AND pending_slot IS NULL)
      );

    ALTER TABLE search_conversations
      ADD CONSTRAINT search_conversations_search_request_status_check CHECK (
        (status = 'active' AND pending_slot = 'selection' AND search_request_id IS NOT NULL)
        OR (status = 'active' AND pending_slot IN ('location', 'service', 'location_confirmation') AND search_request_id IS NULL)
        OR status <> 'active'
      );

    ALTER TABLE search_conversations
      ADD CONSTRAINT search_conversations_resume_slot_check CHECK (
        resume_slot IS NULL OR resume_slot IN ('location', 'service', 'selection', 'location_confirmation')
      );

    ALTER TABLE search_conversations
      ADD COLUMN pin_latitude DOUBLE PRECISION NULL,
      ADD COLUMN pin_longitude DOUBLE PRECISION NULL,
      ADD COLUMN pin_name VARCHAR(200) NULL,
      ADD COLUMN location_source VARCHAR(30) NULL,
      ADD COLUMN location_city VARCHAR(120) NULL,
      ADD COLUMN location_state VARCHAR(2) NULL;

    ALTER TABLE search_conversations
      ADD CONSTRAINT search_conversations_pin_coords_chk CHECK (
        (pin_latitude IS NULL AND pin_longitude IS NULL)
        OR (
          pin_latitude IS NOT NULL
          AND pin_longitude IS NOT NULL
          AND pin_latitude BETWEEN -90 AND 90
          AND pin_longitude BETWEEN -180 AND 180
        )
      );

    ALTER TABLE search_conversations
      ADD CONSTRAINT search_conversations_location_source_chk CHECK (
        location_source IS NULL OR location_source IN ('whatsapp_native', 'text_resolved', 'memory_reuse')
      );

    -- 3. Create customer_last_locations table
    CREATE TABLE customer_last_locations (
      customer_id UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
      latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
      longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
      city VARCHAR(120),
      state VARCHAR(2),
      country_code VARCHAR(2) NOT NULL DEFAULT 'BR',
      label VARCHAR(200) NOT NULL,
      source VARCHAR(30) NOT NULL CHECK (source IN ('whatsapp_native', 'text_resolved', 'memory_reuse')),
      confirmed_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TRIGGER customer_last_locations_set_updated_at
      BEFORE UPDATE ON customer_last_locations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    LOCK TABLE
      customer_last_locations,
      channel_inbound_messages,
      search_conversations
    IN ACCESS EXCLUSIVE MODE;

    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM customer_last_locations)
        OR EXISTS (SELECT 1 FROM channel_inbound_messages WHERE latitude IS NOT NULL OR longitude IS NOT NULL)
        OR EXISTS (SELECT 1 FROM search_conversations WHERE pending_slot = 'location_confirmation' OR resume_slot = 'location_confirmation' OR pin_latitude IS NOT NULL)
      THEN
        RAISE EXCEPTION 'LOCATION_V2_ROLLBACK_BLOCKED' USING ERRCODE = 'P0029';
      END IF;
    END $$;

    DROP TABLE customer_last_locations;

    DO $$
    DECLARE
      constraint_record RECORD;
    BEGIN
      FOR constraint_record IN
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = 'search_conversations'::regclass
           AND contype = 'c'
           AND (
             pg_get_constraintdef(oid) LIKE '%pending_slot%'
             OR pg_get_constraintdef(oid) LIKE '%search_request_id%'
             OR pg_get_constraintdef(oid) LIKE '%resume_slot%'
             OR pg_get_constraintdef(oid) LIKE '%pin_%'
             OR pg_get_constraintdef(oid) LIKE '%location_source%'
           )
      LOOP
        EXECUTE format('ALTER TABLE search_conversations DROP CONSTRAINT %I', constraint_record.conname);
      END LOOP;
    END
    $$;

    ALTER TABLE search_conversations
      DROP COLUMN IF EXISTS pin_latitude,
      DROP COLUMN IF EXISTS pin_longitude,
      DROP COLUMN IF EXISTS pin_name,
      DROP COLUMN IF EXISTS location_source,
      DROP COLUMN IF EXISTS location_city,
      DROP COLUMN IF EXISTS location_state;

    ALTER TYPE search_conversation_pending_slot RENAME TO search_conversation_pending_slot_old;
    CREATE TYPE search_conversation_pending_slot AS ENUM ('location', 'service', 'selection');
    ALTER TABLE search_conversations
      ALTER COLUMN pending_slot TYPE search_conversation_pending_slot
      USING pending_slot::TEXT::search_conversation_pending_slot;
    DROP TYPE search_conversation_pending_slot_old;

    ALTER TABLE search_conversations
      ADD CONSTRAINT search_conversations_status_pending_slot_check CHECK (
        (status = 'active' AND pending_slot IS NOT NULL)
        OR (status <> 'active' AND pending_slot IS NULL)
      );

    ALTER TABLE search_conversations
      ADD CONSTRAINT search_conversations_search_request_status_check CHECK (
        (status = 'active' AND pending_slot = 'selection' AND search_request_id IS NOT NULL)
        OR (status = 'active' AND pending_slot IN ('location', 'service') AND search_request_id IS NULL)
        OR status <> 'active'
      );

    ALTER TABLE search_conversations
      ADD CONSTRAINT search_conversations_resume_slot_check CHECK (
        resume_slot IS NULL OR resume_slot IN ('location', 'service', 'selection')
      );

    ALTER TABLE channel_inbound_messages
      DROP CONSTRAINT IF EXISTS channel_inbound_messages_payload_presence_chk,
      DROP CONSTRAINT IF EXISTS channel_inbound_messages_coords_chk;

    ALTER TABLE channel_inbound_messages
      DROP COLUMN IF EXISTS latitude,
      DROP COLUMN IF EXISTS longitude,
      DROP COLUMN IF EXISTS location_name;

    ALTER TABLE channel_inbound_messages
      ALTER COLUMN raw_text SET NOT NULL;
  `);
};
