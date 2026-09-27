exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE professional_unavailability_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
      professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE RESTRICT,
      inbound_id UUID NOT NULL UNIQUE REFERENCES channel_inbound_messages(id) ON DELETE RESTRICT,
      origin TEXT NOT NULL CHECK (origin = 'channel_inbox'),
      rule_version TEXT NOT NULL CHECK (length(rule_version) BETWEEN 1 AND 60),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (contact_id)
    );

    CREATE INDEX professional_unavailability_events_prof_idx
      ON professional_unavailability_events(professional_id, created_at, id);

    CREATE FUNCTION protect_professional_unavailability_event() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'PROFESSIONAL_UNAVAILABILITY_EVENT_IMMUTABLE' USING ERRCODE = 'P0027';
    END $$;

    CREATE TRIGGER professional_unavailability_events_immutable
      BEFORE UPDATE OR DELETE ON professional_unavailability_events
      FOR EACH ROW EXECUTE FUNCTION protect_professional_unavailability_event();

    CREATE TRIGGER professional_unavailability_events_no_truncate
      BEFORE TRUNCATE ON professional_unavailability_events
      FOR EACH STATEMENT EXECUTE FUNCTION protect_professional_unavailability_event();

    ALTER TABLE channel_outbound_messages
      ADD COLUMN professional_unavailability_event_id UUID
      REFERENCES professional_unavailability_events(id) ON DELETE RESTRICT;

    CREATE INDEX channel_outbound_messages_unavailability_event_idx
      ON channel_outbound_messages(professional_unavailability_event_id)
      WHERE professional_unavailability_event_id IS NOT NULL;

    -- PREFLIGHT: detect same-search/same-professional duplicates that cannot be
    -- represented under the new v2 unique index. These are an impossible v1 state
    -- (migration 015 already prevents same-professional duplicates per search).
    -- Raise a deterministic error rather than silently violating invariants.
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM contacts
         WHERE bilateral_snapshot IS NOT NULL
         GROUP BY search_request_id, professional_id
        HAVING COUNT(*) > 1
      ) THEN
        RAISE EXCEPTION 'CONNECTION_LIFECYCLE_V2_UPGRADE_CONFLICT: same search_request_id + professional_id bilateral contacts detected; manual data reconciliation required before applying migration 027'
          USING ERRCODE = 'P0027';
      END IF;
    END $$;

    -- Drop the legacy partial unique index BEFORE normalizing statuses.
    -- The legacy index excludes 'declined', so normalizing declined→shared while
    -- the index still exists would cause 23505 when two contacts for the same
    -- search exist (e.g. João declined then Carlos requested).
    DROP INDEX IF EXISTS contacts_bilateral_search_unique_idx;
    DROP INDEX IF EXISTS contacts_pending_professional_idx;

    -- Now safe to normalize: no legacy unique index is present.
    UPDATE contacts
       SET status = 'shared'
     WHERE bilateral_snapshot IS NOT NULL
       AND status IN ('requested', 'accepted', 'declined');

    CREATE UNIQUE INDEX contacts_bilateral_search_professional_unique_idx
      ON contacts(search_request_id, professional_id)
      WHERE bilateral_snapshot IS NOT NULL;

    CREATE INDEX contacts_active_professional_idx
      ON contacts(professional_id, created_at)
      WHERE bilateral_snapshot IS NOT NULL AND status = 'shared';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    LOCK TABLE contacts, professional_unavailability_events, channel_outbound_messages IN ACCESS EXCLUSIVE MODE;

    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM professional_unavailability_events)
         OR EXISTS (SELECT 1 FROM channel_outbound_messages WHERE professional_unavailability_event_id IS NOT NULL)
         OR EXISTS (
           SELECT 1 FROM contacts
            WHERE bilateral_snapshot IS NOT NULL
            GROUP BY search_request_id
           HAVING COUNT(*) > 1
         )
      THEN
        RAISE EXCEPTION 'CONNECTION_LIFECYCLE_V2_ROLLBACK_BLOCKED' USING ERRCODE = 'P0027';
      END IF;
    END $$;

    UPDATE contacts c
       SET status = COALESCE(
         (SELECT ore.next_state FROM opportunity_response_events ore WHERE ore.contact_id = c.id),
         'requested'
       )::contact_status
     WHERE c.bilateral_snapshot IS NOT NULL
       AND c.status = 'shared';

    DROP INDEX IF EXISTS contacts_active_professional_idx;
    DROP INDEX IF EXISTS contacts_bilateral_search_professional_unique_idx;

    CREATE UNIQUE INDEX contacts_bilateral_search_unique_idx
      ON contacts(search_request_id)
      WHERE bilateral_snapshot IS NOT NULL AND status <> 'declined';

    CREATE INDEX contacts_pending_professional_idx
      ON contacts(professional_id, created_at)
      WHERE bilateral_snapshot IS NOT NULL AND status = 'requested';

    DROP INDEX IF EXISTS channel_outbound_messages_unavailability_event_idx;
    ALTER TABLE channel_outbound_messages DROP COLUMN IF EXISTS professional_unavailability_event_id;

    DROP TRIGGER IF EXISTS professional_unavailability_events_no_truncate ON professional_unavailability_events;
    DROP TRIGGER IF EXISTS professional_unavailability_events_immutable ON professional_unavailability_events;
    DROP FUNCTION IF EXISTS protect_professional_unavailability_event();
    DROP TABLE IF EXISTS professional_unavailability_events;
  `);
};
