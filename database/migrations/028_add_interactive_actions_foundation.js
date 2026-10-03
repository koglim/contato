exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Add interactive_payload to channel_outbound_messages and replace message_type constraint
    ALTER TABLE channel_outbound_messages
      ADD COLUMN interactive_payload JSONB NULL;

    ALTER TABLE channel_outbound_messages
      DROP CONSTRAINT IF EXISTS channel_outbound_messages_message_type_check;

    ALTER TABLE channel_outbound_messages
      ADD CONSTRAINT channel_outbound_messages_message_type_payload_chk
      CHECK (
        (message_type = 'text' AND interactive_payload IS NULL)
        OR (message_type = 'interactive' AND interactive_payload IS NOT NULL)
      );

    -- 2. Add interactive_action_id to channel_inbound_messages and index
    ALTER TABLE channel_inbound_messages
      ADD COLUMN interactive_action_id VARCHAR(120) NULL;

    CREATE INDEX channel_inbound_messages_action_id_idx
      ON channel_inbound_messages(interactive_action_id)
      WHERE interactive_action_id IS NOT NULL;

    -- 3. Add supporting UNIQUE constraint on contact_completions(contact_id, id) for composite FK
    ALTER TABLE contact_completions
      ADD CONSTRAINT contact_completions_contact_id_id_key UNIQUE (contact_id, id);

    -- 4. Create interactive_action_tokens table
    CREATE TABLE interactive_action_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      public_token VARCHAR(120) NOT NULL UNIQUE,
      action_type TEXT NOT NULL,
      contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
      completion_id UUID NULL,
      intended_actor_role TEXT NOT NULL CHECK (intended_actor_role IN ('customer', 'professional')),
      intended_phone_e164 VARCHAR(32) NOT NULL CHECK (intended_phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
      outbound_message_id UUID NOT NULL REFERENCES channel_outbound_messages(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'consumed', 'revoked', 'expired')),
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      consumed_inbound_id UUID UNIQUE REFERENCES channel_inbound_messages(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT interactive_action_tokens_public_token_chk CHECK (
        char_length(public_token) BETWEEN 1 AND 120
        AND public_token !~ '\\s'
      ),
      CONSTRAINT check_interactive_action_token_type_role_completion CHECK (
        (action_type = 'confirm_completion' AND completion_id IS NOT NULL AND intended_actor_role = 'customer')
        OR (action_type = 'contest_completion' AND completion_id IS NOT NULL AND intended_actor_role = 'customer')
        OR (action_type = 'declare_completion' AND completion_id IS NULL AND intended_actor_role = 'professional')
        OR (action_type = 'declare_unavailability' AND completion_id IS NULL AND intended_actor_role = 'professional')
      ),
      CONSTRAINT check_interactive_action_token_consumption CHECK (
        (status = 'consumed' AND consumed_at IS NOT NULL AND consumed_inbound_id IS NOT NULL)
        OR (status <> 'consumed' AND consumed_at IS NULL AND consumed_inbound_id IS NULL)
      ),
      CONSTRAINT interactive_action_tokens_contact_completion_fk
        FOREIGN KEY (contact_id, completion_id)
        REFERENCES contact_completions(contact_id, id)
        ON DELETE RESTRICT
    );

    CREATE INDEX interactive_action_tokens_contact_idx
      ON interactive_action_tokens(contact_id, action_type, status);

    CREATE INDEX interactive_action_tokens_expiry_idx
      ON interactive_action_tokens(status, expires_at)
      WHERE status = 'active';

    CREATE TRIGGER interactive_action_tokens_set_updated_at
      BEFORE UPDATE ON interactive_action_tokens
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    LOCK TABLE
      interactive_action_tokens,
      channel_outbound_messages,
      channel_inbound_messages
    IN ACCESS EXCLUSIVE MODE;

    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM interactive_action_tokens)
        OR EXISTS (SELECT 1 FROM channel_outbound_messages WHERE message_type = 'interactive' OR interactive_payload IS NOT NULL)
        OR EXISTS (SELECT 1 FROM channel_inbound_messages WHERE interactive_action_id IS NOT NULL)
      THEN
        RAISE EXCEPTION 'INTERACTIVE_ACTIONS_ROLLBACK_BLOCKED' USING ERRCODE = 'P0028';
      END IF;
    END $$;

    DROP TABLE interactive_action_tokens;

    ALTER TABLE contact_completions
      DROP CONSTRAINT IF EXISTS contact_completions_contact_id_id_key;

    DROP INDEX IF EXISTS channel_inbound_messages_action_id_idx;
    ALTER TABLE channel_inbound_messages
      DROP COLUMN IF EXISTS interactive_action_id;

    ALTER TABLE channel_outbound_messages
      DROP CONSTRAINT IF EXISTS channel_outbound_messages_message_type_payload_chk;

    ALTER TABLE channel_outbound_messages
      DROP COLUMN IF EXISTS interactive_payload;

    ALTER TABLE channel_outbound_messages
      ADD CONSTRAINT channel_outbound_messages_message_type_check
      CHECK (message_type = 'text');
  `);
};
