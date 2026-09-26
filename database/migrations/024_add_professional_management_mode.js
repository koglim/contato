exports.up = pgm => {
  pgm.sql(`
    ALTER TABLE professionals
      ADD COLUMN management_mode TEXT NOT NULL DEFAULT 'legacy_unmanaged'
        CHECK (management_mode IN ('legacy_unmanaged', 'account_managed'));

    UPDATE professionals
       SET management_mode = 'account_managed'
     WHERE id IN (
       SELECT professional_id
         FROM professional_membership_events
        WHERE source = 'self_onboarding'
     );

    ALTER TABLE professional_membership_events
      DROP CONSTRAINT professional_membership_events_source_chk,
      DROP CONSTRAINT professional_membership_events_actor_source_chk;

    ALTER TABLE professional_membership_events
      ADD CONSTRAINT professional_membership_events_source_chk
        CHECK (source IS NULL OR source IN ('self_onboarding', 'internal_provisioning', 'legacy_claim')),
      ADD CONSTRAINT professional_membership_events_actor_source_chk
        CHECK (
          (source IS NULL AND actor_account_id IS NULL)
          OR (source = 'self_onboarding' AND actor_account_id IS NOT NULL)
          OR (source = 'legacy_claim' AND actor_account_id IS NOT NULL)
          OR (source = 'internal_provisioning' AND actor_account_id IS NULL)
        );
  `);
};

exports.down = pgm => {
  pgm.sql(`
    LOCK TABLE professionals IN ACCESS EXCLUSIVE MODE;
    LOCK TABLE professional_membership_events IN ACCESS EXCLUSIVE MODE;
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM professionals WHERE management_mode = 'account_managed')
         OR EXISTS (SELECT 1 FROM professional_membership_events WHERE source = 'legacy_claim')
      THEN RAISE EXCEPTION 'PROFESSIONAL_MANAGEMENT_MODE_ROLLBACK_BLOCKED' USING ERRCODE = 'P0024'; END IF;
    END $$;

    ALTER TABLE professional_membership_events
      DROP CONSTRAINT professional_membership_events_actor_source_chk,
      DROP CONSTRAINT professional_membership_events_source_chk;

    ALTER TABLE professional_membership_events
      ADD CONSTRAINT professional_membership_events_source_chk
        CHECK (source IS NULL OR source IN ('self_onboarding', 'internal_provisioning')),
      ADD CONSTRAINT professional_membership_events_actor_source_chk
        CHECK (
          (source IS NULL AND actor_account_id IS NULL)
          OR (source = 'self_onboarding' AND actor_account_id IS NOT NULL)
          OR (source = 'internal_provisioning' AND actor_account_id IS NULL)
        );

    ALTER TABLE professionals
      DROP COLUMN management_mode;
  `);
};
