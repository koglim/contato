exports.up = pgm => {
  pgm.sql(`
    ALTER TABLE channel_outbound_messages DROP CONSTRAINT channel_outbound_messages_purpose_context_chk;
    ALTER TABLE channel_outbound_messages ADD COLUMN expires_at TIMESTAMPTZ;
    ALTER TABLE channel_outbound_messages ADD CONSTRAINT channel_outbound_messages_purpose_context_chk CHECK (
      (purpose IN ('customer_reply','professional_reply') AND channel_inbound_message_id IS NOT NULL)
      OR (purpose IN ('professional_contact_notification','customer_contact_update','channel_notice','professional_auth_challenge') AND channel_inbound_message_id IS NULL)
    );
    ALTER TABLE channel_outbound_messages ADD CONSTRAINT channel_outbound_messages_auth_expiry_chk CHECK (
      purpose <> 'professional_auth_challenge' OR expires_at IS NOT NULL
    );

    CREATE TABLE professional_auth_challenges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      account_identifier_id UUID NOT NULL REFERENCES account_identifiers(id) ON DELETE RESTRICT,
      code_hash TEXT NOT NULL CHECK (code_hash ~ '^[a-f0-9]{64}$'),
      expires_at TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
      consumed_at TIMESTAMPTZ,
      invalidated_at TIMESTAMPTZ,
      outbound_id UUID UNIQUE REFERENCES channel_outbound_messages(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (expires_at > created_at),
      CHECK (consumed_at IS NULL OR invalidated_at IS NULL)
    );
    CREATE INDEX professional_auth_challenges_identifier_created_idx
      ON professional_auth_challenges(account_identifier_id, created_at DESC);
    CREATE UNIQUE INDEX professional_auth_challenges_one_active_idx
      ON professional_auth_challenges(account_identifier_id)
      WHERE consumed_at IS NULL AND invalidated_at IS NULL;
    CREATE INDEX channel_outbound_messages_auth_claim_idx
      ON channel_outbound_messages(expires_at, created_at, id)
      WHERE purpose = 'professional_auth_challenge'
        AND administrative_closed_at IS NULL
        AND status IN ('pending','failed','processing');

    CREATE TABLE professional_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      CHECK (expires_at > created_at)
    );
    CREATE INDEX professional_sessions_active_account_idx ON professional_sessions(account_id, expires_at)
      WHERE revoked_at IS NULL;
  `);
};

exports.down = pgm => {
  pgm.sql(`
    LOCK TABLE professional_auth_challenges, professional_sessions, channel_outbound_messages IN ACCESS EXCLUSIVE MODE;
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM professional_auth_challenges)
        OR EXISTS (SELECT 1 FROM professional_sessions)
        OR EXISTS (SELECT 1 FROM channel_outbound_messages WHERE purpose = 'professional_auth_challenge')
      THEN RAISE EXCEPTION 'PROFESSIONAL_AUTH_ROLLBACK_BLOCKED' USING ERRCODE = 'P0022'; END IF;
    END $$;
    DROP TABLE professional_auth_challenges;
    DROP TABLE professional_sessions;
    DROP INDEX channel_outbound_messages_auth_claim_idx;
    ALTER TABLE channel_outbound_messages DROP CONSTRAINT channel_outbound_messages_auth_expiry_chk;
    ALTER TABLE channel_outbound_messages DROP COLUMN expires_at;
    ALTER TABLE channel_outbound_messages DROP CONSTRAINT channel_outbound_messages_purpose_context_chk;
    ALTER TABLE channel_outbound_messages ADD CONSTRAINT channel_outbound_messages_purpose_context_chk CHECK (
      (purpose IN ('customer_reply','professional_reply') AND channel_inbound_message_id IS NOT NULL)
      OR (purpose IN ('professional_contact_notification','customer_contact_update','channel_notice') AND channel_inbound_message_id IS NULL)
    );
  `);
};
