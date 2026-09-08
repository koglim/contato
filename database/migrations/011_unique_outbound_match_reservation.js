exports.up = (pgm) => {
  pgm.sql(`
    CREATE UNIQUE INDEX channel_outbound_message_matches_match_id_unique_idx
      ON channel_outbound_message_matches(match_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS channel_outbound_message_matches_match_id_unique_idx;
  `);
};
