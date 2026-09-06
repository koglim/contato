const dropSelectionRelatedChecks = `
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
           (pg_get_constraintdef(oid) LIKE '%pending_slot%' AND pg_get_constraintdef(oid) LIKE '%status%')
           OR (pg_get_constraintdef(oid) LIKE '%search_request_id%' AND pg_get_constraintdef(oid) LIKE '%status%')
         )
    LOOP
      EXECUTE format('ALTER TABLE search_conversations DROP CONSTRAINT %I', constraint_record.conname);
    END LOOP;
  END
  $$;
`;

const addPreviousChecks = `
  ALTER TABLE search_conversations
    ADD CONSTRAINT search_conversations_status_pending_slot_check CHECK (
      (status = 'active' AND pending_slot IS NOT NULL)
      OR (status <> 'active' AND pending_slot IS NULL)
    );

  ALTER TABLE search_conversations
    ADD CONSTRAINT search_conversations_search_request_status_check CHECK (
      search_request_id IS NULL OR status = 'completed'
    );
`;

exports.up = (pgm) => {
  pgm.sql(`
    ${dropSelectionRelatedChecks}

    ALTER TYPE search_conversation_pending_slot
      RENAME TO search_conversation_pending_slot_old;
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

    CREATE INDEX search_conversations_search_request_id_idx
      ON search_conversations(search_request_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    UPDATE search_conversations
       SET status = 'cancelled',
           pending_slot = NULL,
           search_request_id = NULL,
           processing_token = NULL,
           processing_started_at = NULL
     WHERE pending_slot = 'selection';

    ${dropSelectionRelatedChecks}

    ALTER TYPE search_conversation_pending_slot
      RENAME TO search_conversation_pending_slot_old;
    CREATE TYPE search_conversation_pending_slot AS ENUM ('location', 'service');
    ALTER TABLE search_conversations
      ALTER COLUMN pending_slot TYPE search_conversation_pending_slot
      USING pending_slot::TEXT::search_conversation_pending_slot;
    DROP TYPE search_conversation_pending_slot_old;

    ${addPreviousChecks}

    DROP INDEX IF EXISTS search_conversations_search_request_id_idx;
  `);
};
