exports.up = (pgm) => {
  pgm.sql(`
    CREATE UNIQUE INDEX search_conversations_one_active_per_customer_idx
      ON search_conversations (customer_id)
      WHERE customer_id IS NOT NULL AND status = 'active';
  `);
};

exports.down = (pgm) => {
  pgm.sql("DROP INDEX search_conversations_one_active_per_customer_idx;");
};
