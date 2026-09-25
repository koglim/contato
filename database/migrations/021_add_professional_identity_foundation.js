exports.up = pgm => {
  pgm.sql(`
    CREATE TABLE accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TRIGGER accounts_updated_at BEFORE UPDATE ON accounts
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE account_identifiers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      kind TEXT NOT NULL CHECK (kind IN ('phone', 'email')),
      normalized_value TEXT NOT NULL,
      verified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT account_identifiers_canonical_check CHECK (
        (kind = 'phone' AND normalized_value ~ '^[+][1-9][0-9]{7,14}$')
        OR (kind = 'email' AND length(normalized_value) <= 320
          AND length(split_part(normalized_value, '@', 1)) <= 64
          AND normalized_value !~ '[.][.]'
          AND normalized_value ~ '^[a-z0-9][a-z0-9._%+-]*@[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')
      )
    );
    CREATE UNIQUE INDEX account_identifiers_kind_value_uidx ON account_identifiers(kind, normalized_value);
    CREATE INDEX account_identifiers_verified_account_idx ON account_identifiers(account_id)
      WHERE verified_at IS NOT NULL;

    CREATE TABLE professional_memberships (
      account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE RESTRICT,
      role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (account_id, professional_id)
    );
    CREATE INDEX professional_memberships_active_professional_idx ON professional_memberships(professional_id)
      WHERE status = 'active';
    CREATE TRIGGER professional_memberships_updated_at BEFORE UPDATE ON professional_memberships
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE professional_membership_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id UUID NOT NULL,
      professional_id UUID NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('created', 'changed')),
      previous_role TEXT CHECK (previous_role IS NULL OR previous_role IN ('owner', 'admin', 'member')),
      new_role TEXT NOT NULL CHECK (new_role IN ('owner', 'admin', 'member')),
      previous_status TEXT CHECK (previous_status IS NULL OR previous_status IN ('active', 'revoked')),
      new_status TEXT NOT NULL CHECK (new_status IN ('active', 'revoked')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      FOREIGN KEY (account_id, professional_id)
        REFERENCES professional_memberships(account_id, professional_id) ON DELETE RESTRICT
    );
    CREATE INDEX professional_membership_events_professional_idx
      ON professional_membership_events(professional_id, created_at, id);
    CREATE FUNCTION audit_professional_membership() RETURNS trigger LANGUAGE plpgsql AS $$
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
    CREATE TRIGGER professional_membership_audit AFTER INSERT OR UPDATE ON professional_memberships
      FOR EACH ROW EXECUTE FUNCTION audit_professional_membership();
    CREATE FUNCTION protect_professional_membership() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'PROFESSIONAL_MEMBERSHIP_IMMUTABLE' USING ERRCODE = 'P0021'; END $$;
    CREATE TRIGGER professional_membership_no_delete BEFORE DELETE ON professional_memberships
      FOR EACH ROW EXECUTE FUNCTION protect_professional_membership();
    CREATE TRIGGER professional_membership_event_immutable BEFORE UPDATE OR DELETE ON professional_membership_events
      FOR EACH ROW EXECUTE FUNCTION protect_professional_membership();
    CREATE TRIGGER professional_membership_no_truncate BEFORE TRUNCATE ON professional_memberships
      FOR EACH STATEMENT EXECUTE FUNCTION protect_professional_membership();
    CREATE TRIGGER professional_membership_event_no_truncate BEFORE TRUNCATE ON professional_membership_events
      FOR EACH STATEMENT EXECUTE FUNCTION protect_professional_membership();
  `);
};

exports.down = pgm => {
  pgm.sql(`
    LOCK TABLE professional_membership_events, professional_memberships, account_identifiers, accounts IN ACCESS EXCLUSIVE MODE;
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM accounts) OR EXISTS (SELECT 1 FROM account_identifiers)
        OR EXISTS (SELECT 1 FROM professional_memberships) OR EXISTS (SELECT 1 FROM professional_membership_events)
      THEN RAISE EXCEPTION 'PROFESSIONAL_IDENTITY_ROLLBACK_BLOCKED' USING ERRCODE = 'P0021'; END IF;
    END $$;
    DROP TABLE professional_membership_events;
    DROP TABLE professional_memberships;
    DROP TABLE account_identifiers;
    DROP TABLE accounts;
    DROP FUNCTION audit_professional_membership();
    DROP FUNCTION protect_professional_membership();
  `);
};
