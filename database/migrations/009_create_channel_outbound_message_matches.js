exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE channel_outbound_message_matches (
      channel_outbound_message_id UUID NOT NULL
        REFERENCES channel_outbound_messages(id) ON DELETE CASCADE,
      match_id UUID NOT NULL
        REFERENCES matches(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (channel_outbound_message_id, match_id)
    );

    CREATE INDEX channel_outbound_message_matches_match_id_idx
      ON channel_outbound_message_matches(match_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS channel_outbound_message_matches_match_id_idx;
    DROP TABLE channel_outbound_message_matches;
  `);
};
