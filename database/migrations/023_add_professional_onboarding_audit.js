exports.up = pgm => {
  pgm.sql(`
    ALTER TABLE professional_membership_events
      ADD COLUMN actor_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
      ADD COLUMN source TEXT,
      ADD CONSTRAINT professional_membership_events_source_chk
        CHECK (source IS NULL OR source IN ('self_onboarding','internal_provisioning')),
      ADD CONSTRAINT professional_membership_events_actor_source_chk
        CHECK (
          (source IS NULL AND actor_account_id IS NULL)
          OR (source = 'self_onboarding' AND actor_account_id IS NOT NULL)
          OR (source = 'internal_provisioning' AND actor_account_id IS NULL)
        );

    CREATE OR REPLACE FUNCTION audit_professional_membership() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      event_actor UUID := NULLIF(current_setting('contatocerto.membership_actor_account_id', true), '')::UUID;
      event_source TEXT := COALESCE(NULLIF(current_setting('contatocerto.membership_source', true), ''), 'internal_provisioning');
    BEGIN
      IF TG_OP = 'INSERT' THEN
        INSERT INTO professional_membership_events(account_id, professional_id, action, new_role, new_status, actor_account_id, source)
        VALUES (NEW.account_id, NEW.professional_id, 'created', NEW.role, NEW.status, event_actor, event_source);
      ELSIF OLD.role IS DISTINCT FROM NEW.role OR OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO professional_membership_events(account_id, professional_id, action,
          previous_role, new_role, previous_status, new_status, actor_account_id, source)
        VALUES (NEW.account_id, NEW.professional_id, 'changed',
          OLD.role, NEW.role, OLD.status, NEW.status, event_actor, event_source);
      END IF;
      RETURN NEW;
    END $$;
  `);
};

exports.down = pgm => {
  pgm.sql(`
    LOCK TABLE professional_membership_events IN ACCESS EXCLUSIVE MODE;
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM professional_membership_events
        WHERE actor_account_id IS NOT NULL OR source IS NOT NULL)
      THEN RAISE EXCEPTION 'PROFESSIONAL_ONBOARDING_AUDIT_ROLLBACK_BLOCKED' USING ERRCODE = 'P0023'; END IF;
    END $$;
    CREATE OR REPLACE FUNCTION audit_professional_membership() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        INSERT INTO professional_membership_events(account_id, professional_id, action, new_role, new_status)
        VALUES (NEW.account_id, NEW.professional_id, 'created', NEW.role, NEW.status);
      ELSIF OLD.role IS DISTINCT FROM NEW.role OR OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO professional_membership_events(account_id, professional_id, action,
          previous_role, new_role, previous_status, new_status)
        VALUES (NEW.account_id, NEW.professional_id, 'changed',
          OLD.role, NEW.role, OLD.status, NEW.status);
      END IF;
      RETURN NEW;
    END $$;
    ALTER TABLE professional_membership_events
      DROP CONSTRAINT professional_membership_events_actor_source_chk,
      DROP CONSTRAINT professional_membership_events_source_chk,
      DROP COLUMN source,
      DROP COLUMN actor_account_id;
  `);
};
