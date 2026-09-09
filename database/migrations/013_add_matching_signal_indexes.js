exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX matches_professional_shown_at_idx
      ON matches (professional_id, shown_at) WHERE shown_at IS NOT NULL;
    CREATE INDEX contacts_professional_created_at_idx
      ON contacts (professional_id, created_at);
    CREATE INDEX reviews_published_professional_idx
      ON reviews (professional_id) WHERE status = 'published';
  `);
};

exports.down = (pgm) => {
  // Only indexes owned by this migration are removed; business data is retained.
  pgm.sql(`
    DROP INDEX reviews_published_professional_idx;
    DROP INDEX contacts_professional_created_at_idx;
    DROP INDEX matches_professional_shown_at_idx;
  `);
};
