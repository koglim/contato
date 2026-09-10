exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE channel_inbound_messages ADD COLUMN contextual_queue BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE TABLE contextual_memories (
      customer_id UUID PRIMARY KEY REFERENCES customers(id) ON DELETE RESTRICT,
      memory JSONB NOT NULL DEFAULT '{"conversationId":null,"service":null,"location":null,"hypotheses":[]}',
      revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
      conversation_fingerprint TEXT,
      lease_token UUID, lease_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
    );
    CREATE TABLE contextual_turns (
      inbound_id UUID PRIMARY KEY REFERENCES channel_inbound_messages(id) ON DELETE RESTRICT,
      customer_id UUID NOT NULL REFERENCES contextual_memories(customer_id) ON DELETE RESTRICT,
      context_revision INTEGER NOT NULL,
      context_fingerprint TEXT,
      proposal JSONB,
      reply_draft TEXT CHECK (reply_draft IS NULL OR length(reply_draft) BETWEEN 5 AND 240),
      model TEXT NOT NULL,
      version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
      error_code TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX contextual_turns_pending_idx ON contextual_turns(customer_id, created_at, inbound_id) WHERE status = 'pending';
    CREATE TABLE contextual_budgets (
      scope TEXT NOT NULL, window_start TIMESTAMPTZ NOT NULL, calls INTEGER NOT NULL CHECK (calls > 0),
      PRIMARY KEY (scope, window_start)
    );
  `);
};
exports.down = (pgm) => {
  pgm.sql(`
    LOCK TABLE contextual_memories, contextual_turns, contextual_budgets, channel_inbound_messages IN ACCESS EXCLUSIVE MODE;
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM contextual_memories) OR EXISTS (SELECT 1 FROM contextual_turns)
        OR EXISTS (SELECT 1 FROM channel_inbound_messages WHERE contextual_queue) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0018', MESSAGE = 'CONTEXTUAL_ROLLBACK_BLOCKED';
      END IF;
    END $$;
    DROP TABLE contextual_turns, contextual_memories, contextual_budgets;
    ALTER TABLE channel_inbound_messages DROP COLUMN contextual_queue;
  `);
};
