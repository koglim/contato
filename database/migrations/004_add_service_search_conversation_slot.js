const dropPendingSlotCheck = `
  DO $$
  DECLARE
    constraint_name TEXT;
  BEGIN
    SELECT conname
      INTO constraint_name
      FROM pg_constraint
     WHERE conrelid = 'search_conversations'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%pending_slot%'
       AND pg_get_constraintdef(oid) LIKE '%status%';

    IF constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE search_conversations DROP CONSTRAINT %I', constraint_name);
    END IF;
  END
  $$;
`;

exports.up = (pgm) => {
  pgm.sql(`
    ${dropPendingSlotCheck}

    ALTER TYPE search_conversation_pending_slot
      RENAME TO search_conversation_pending_slot_old;
    CREATE TYPE search_conversation_pending_slot AS ENUM ('location', 'service');
    ALTER TABLE search_conversations
      ALTER COLUMN pending_slot TYPE search_conversation_pending_slot
      USING pending_slot::TEXT::search_conversation_pending_slot;
    DROP TYPE search_conversation_pending_slot_old;

    ALTER TABLE search_conversations ADD COLUMN location_text TEXT;

    ALTER TABLE search_conversations
      ADD CONSTRAINT search_conversations_status_pending_slot_check CHECK (
        (status = 'active' AND pending_slot IS NOT NULL)
        OR (status <> 'active' AND pending_slot IS NULL)
      );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    UPDATE search_conversations
       SET status = 'cancelled',
           pending_slot = NULL,
           processing_token = NULL,
           processing_started_at = NULL
     WHERE pending_slot = 'service';

    ${dropPendingSlotCheck}

    ALTER TYPE search_conversation_pending_slot
      RENAME TO search_conversation_pending_slot_old;
    CREATE TYPE search_conversation_pending_slot AS ENUM ('location');
    ALTER TABLE search_conversations
      ALTER COLUMN pending_slot TYPE search_conversation_pending_slot
      USING pending_slot::TEXT::search_conversation_pending_slot;
    DROP TYPE search_conversation_pending_slot_old;

    ALTER TABLE search_conversations DROP COLUMN location_text;

    ALTER TABLE search_conversations
      ADD CONSTRAINT search_conversations_status_pending_slot_check CHECK (
        (status = 'active' AND pending_slot = 'location')
        OR (status <> 'active' AND pending_slot IS NULL)
      );
  `);
};
