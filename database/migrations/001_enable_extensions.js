exports.up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS postgis');
  pgm.sql('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  pgm.sql('CREATE EXTENSION IF NOT EXISTS unaccent');
  pgm.sql('CREATE EXTENSION IF NOT EXISTS pgcrypto');
};

exports.down = () => {
  // Extensions are shared database capabilities and are intentionally retained.
};
