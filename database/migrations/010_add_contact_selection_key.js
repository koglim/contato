exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE contacts ADD COLUMN selection_key UUID;

    CREATE UNIQUE INDEX contacts_selection_key_unique_idx
      ON contacts(selection_key)
      WHERE selection_key IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS contacts_selection_key_unique_idx;
    ALTER TABLE contacts DROP COLUMN selection_key;
  `);
};
