exports.up = pgm => {
  pgm.sql(`
    CREATE TABLE subscription_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TRIGGER subscription_plans_updated_at BEFORE UPDATE ON subscription_plans
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE subscription_plan_entitlements (
      plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
      entitlement_key TEXT NOT NULL CHECK (entitlement_key IN ('marketplace_access')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (plan_id, entitlement_key)
    );

    CREATE TABLE professional_subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      professional_id UUID NOT NULL UNIQUE REFERENCES professionals(id) ON DELETE RESTRICT,
      plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT check_subscription_period CHECK (ends_at > starts_at)
    );
    CREATE TRIGGER professional_subscriptions_updated_at BEFORE UPDATE ON professional_subscriptions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE professional_subscription_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      subscription_id UUID NOT NULL REFERENCES professional_subscriptions(id) ON DELETE RESTRICT,
      professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE RESTRICT,
      action TEXT NOT NULL CHECK (action IN ('granted', 'extended', 'revoked', 'reactivated')),
      source TEXT NOT NULL CHECK (source IN ('internal_provisioning')),
      previous_starts_at TIMESTAMPTZ,
      new_starts_at TIMESTAMPTZ,
      previous_ends_at TIMESTAMPTZ,
      new_ends_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX professional_subscription_events_subscription_idx
      ON professional_subscription_events(subscription_id, created_at, id);
    CREATE INDEX professional_subscription_events_professional_idx
      ON professional_subscription_events(professional_id, created_at, id);

    CREATE FUNCTION protect_professional_subscription_events() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'PROFESSIONAL_SUBSCRIPTION_EVENT_IMMUTABLE' USING ERRCODE = 'P0025'; END $$;

    CREATE TRIGGER professional_subscription_events_immutable BEFORE UPDATE OR DELETE ON professional_subscription_events
      FOR EACH ROW EXECUTE FUNCTION protect_professional_subscription_events();
    CREATE TRIGGER professional_subscription_events_no_truncate BEFORE TRUNCATE ON professional_subscription_events
      FOR EACH STATEMENT EXECUTE FUNCTION protect_professional_subscription_events();

    INSERT INTO subscription_plans (id, code, name, is_active)
    VALUES ('d3b07384-d113-4f9e-b7a4-0c2d3e4f5a6b', 'marketplace_standard_v1', 'Marketplace Standard', true)
    ON CONFLICT (code) DO NOTHING;

    INSERT INTO subscription_plan_entitlements (plan_id, entitlement_key)
    SELECT id, 'marketplace_access'
    FROM subscription_plans
    WHERE code = 'marketplace_standard_v1'
    ON CONFLICT DO NOTHING;
  `);
};

exports.down = pgm => {
  pgm.sql(`
    LOCK TABLE professional_subscription_events, professional_subscriptions IN ACCESS EXCLUSIVE MODE;
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM professional_subscriptions)
         OR EXISTS (SELECT 1 FROM professional_subscription_events)
      THEN RAISE EXCEPTION 'PROFESSIONAL_SUBSCRIPTION_ROLLBACK_BLOCKED' USING ERRCODE = 'P0025'; END IF;
    END $$;

    DROP TRIGGER professional_subscription_events_no_truncate ON professional_subscription_events;
    DROP TRIGGER professional_subscription_events_immutable ON professional_subscription_events;
    DROP FUNCTION protect_professional_subscription_events();
    DROP TABLE professional_subscription_events;
    DROP TABLE professional_subscriptions;
    DROP TABLE subscription_plan_entitlements;
    DROP TABLE subscription_plans;
  `);
};
