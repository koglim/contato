exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE professional_status AS ENUM ('draft', 'active', 'suspended');
    CREATE TYPE price_mode AS ENUM ('quote', 'fixed', 'from', 'range');
    CREATE TYPE search_request_status AS ENUM ('collecting', 'ready', 'matched', 'selected', 'cancelled');
    CREATE TYPE contact_status AS ENUM ('requested', 'shared', 'accepted', 'declined', 'completed', 'cancelled');
    CREATE TYPE review_status AS ENUM ('pending', 'published', 'hidden');

    CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TABLE customers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      phone_e164 VARCHAR(32) NOT NULL UNIQUE,
      name VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE service_categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(120) NOT NULL,
      slug VARCHAR(140) NOT NULL UNIQUE,
      description TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE services (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      category_id UUID NOT NULL REFERENCES service_categories(id) ON DELETE RESTRICT,
      name VARCHAR(120) NOT NULL,
      slug VARCHAR(140) NOT NULL UNIQUE,
      description TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE service_aliases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      alias VARCHAR(255) NOT NULL,
      normalized_alias VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(service_id, normalized_alias)
    );

    CREATE TABLE professionals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      display_name VARCHAR(255) NOT NULL,
      slug VARCHAR(140) NOT NULL UNIQUE,
      bio TEXT,
      phone_e164 VARCHAR(32) NOT NULL,
      email VARCHAR(320),
      profile_image_url TEXT,
      status professional_status NOT NULL DEFAULT 'draft',
      is_verified BOOLEAN NOT NULL DEFAULT FALSE,
      is_available_now BOOLEAN NOT NULL DEFAULT FALSE,
      available_now_updated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE professional_services (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE RESTRICT,
      service_id UUID NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
      description TEXT,
      price_mode price_mode NOT NULL DEFAULT 'quote',
      price_from_cents INTEGER,
      price_to_cents INTEGER,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(professional_id, service_id),
      CHECK (
        (price_mode = 'quote' AND price_from_cents IS NULL AND price_to_cents IS NULL)
        OR (price_mode IN ('fixed', 'from') AND price_from_cents IS NOT NULL AND price_from_cents >= 0 AND price_to_cents IS NULL)
        OR (price_mode = 'range' AND price_from_cents IS NOT NULL AND price_to_cents IS NOT NULL AND price_from_cents >= 0 AND price_to_cents >= price_from_cents)
      )
    );

    CREATE TABLE professional_service_areas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE RESTRICT,
      label VARCHAR(255),
      city VARCHAR(120) NOT NULL,
      state VARCHAR(120) NOT NULL,
      country_code VARCHAR(2) NOT NULL,
      neighborhood VARCHAR(120),
      center GEOGRAPHY(Point, 4326) NOT NULL,
      radius_meters INTEGER NOT NULL CHECK (radius_meters > 0),
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE search_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
      raw_text TEXT NOT NULL,
      normalized_text TEXT,
      service_id UUID REFERENCES services(id) ON DELETE SET NULL,
      location GEOGRAPHY(Point, 4326),
      city VARCHAR(120),
      state VARCHAR(120),
      neighborhood VARCHAR(120),
      urgency VARCHAR(50),
      preferred_date TIMESTAMPTZ,
      status search_request_status NOT NULL DEFAULT 'collecting',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE matches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      search_request_id UUID NOT NULL REFERENCES search_requests(id) ON DELETE RESTRICT,
      professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE RESTRICT,
      rank_position INTEGER CHECK (rank_position IS NULL OR rank_position > 0),
      score NUMERIC,
      score_breakdown JSONB,
      shown_at TIMESTAMPTZ,
      selected_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(search_request_id, professional_id)
    );

    CREATE TABLE contacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      search_request_id UUID NOT NULL REFERENCES search_requests(id) ON DELETE RESTRICT,
      customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
      professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE RESTRICT,
      status contact_status NOT NULL DEFAULT 'requested',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE reviews (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id UUID NOT NULL UNIQUE REFERENCES contacts(id) ON DELETE RESTRICT,
      customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
      professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE RESTRICT,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT,
      status review_status NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX services_category_id_idx ON services(category_id);
    CREATE INDEX service_aliases_normalized_alias_trgm_idx ON service_aliases USING GIN(normalized_alias gin_trgm_ops);
    CREATE INDEX professional_services_service_id_idx ON professional_services(service_id);
    CREATE INDEX professional_service_areas_professional_id_idx ON professional_service_areas(professional_id);
    CREATE INDEX professional_service_areas_center_gist_idx ON professional_service_areas USING GIST(center);
    CREATE UNIQUE INDEX professional_service_areas_one_primary_idx ON professional_service_areas(professional_id) WHERE is_primary;
    CREATE INDEX search_requests_customer_id_idx ON search_requests(customer_id);
    CREATE INDEX search_requests_service_id_idx ON search_requests(service_id);
    CREATE INDEX search_requests_location_gist_idx ON search_requests USING GIST(location);
    CREATE INDEX matches_professional_id_idx ON matches(professional_id);
    CREATE INDEX contacts_search_request_id_idx ON contacts(search_request_id);
    CREATE INDEX contacts_professional_id_idx ON contacts(professional_id);
    CREATE INDEX reviews_professional_id_idx ON reviews(professional_id);

    CREATE TRIGGER customers_set_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    CREATE TRIGGER service_categories_set_updated_at BEFORE UPDATE ON service_categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    CREATE TRIGGER services_set_updated_at BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    CREATE TRIGGER professionals_set_updated_at BEFORE UPDATE ON professionals FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    CREATE TRIGGER professional_services_set_updated_at BEFORE UPDATE ON professional_services FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    CREATE TRIGGER professional_service_areas_set_updated_at BEFORE UPDATE ON professional_service_areas FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    CREATE TRIGGER search_requests_set_updated_at BEFORE UPDATE ON search_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    CREATE TRIGGER contacts_set_updated_at BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    CREATE TRIGGER reviews_set_updated_at BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE reviews;
    DROP TABLE contacts;
    DROP TABLE matches;
    DROP TABLE search_requests;
    DROP TABLE professional_service_areas;
    DROP TABLE professional_services;
    DROP TABLE professionals;
    DROP TABLE service_aliases;
    DROP TABLE services;
    DROP TABLE service_categories;
    DROP TABLE customers;
    DROP FUNCTION set_updated_at();
    DROP TYPE review_status;
    DROP TYPE contact_status;
    DROP TYPE search_request_status;
    DROP TYPE price_mode;
    DROP TYPE professional_status;
  `);
};
