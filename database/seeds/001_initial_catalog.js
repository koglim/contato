const categories = [
  { name: "Casa e Manutenção", slug: "casa-e-manutencao" },
  { name: "Limpeza", slug: "limpeza" },
  { name: "Assistência Técnica", slug: "assistencia-tecnica" },
];

const services = [
  { name: "Eletricista", slug: "eletricista", categorySlug: "casa-e-manutencao" },
  { name: "Encanador", slug: "encanador", categorySlug: "casa-e-manutencao" },
  { name: "Ar-condicionado", slug: "ar-condicionado", categorySlug: "assistencia-tecnica" },
  { name: "Montador de móveis", slug: "montador-de-moveis", categorySlug: "casa-e-manutencao" },
  { name: "Diarista", slug: "diarista", categorySlug: "limpeza" },
  { name: "Pintor", slug: "pintor", categorySlug: "casa-e-manutencao" },
  { name: "Chaveiro", slug: "chaveiro", categorySlug: "casa-e-manutencao" },
  { name: "Pequenos reparos", slug: "pequenos-reparos", categorySlug: "casa-e-manutencao" },
];

const aliasesByServiceSlug = {
  eletricista: ["eletrica", "eletrico", "instalacao eletrica", "curto circuito", "disjuntor", "tomada", "chuveiro eletrico"],
  encanador: ["encanamento", "vazamento", "cano", "torneira", "descarga"],
  "ar-condicionado": ["ar condicionado", "climatizacao", "instalacao de ar condicionado", "manutencao de ar condicionado"],
  "montador-de-moveis": ["montador de moveis", "montagem de moveis"],
  diarista: ["faxina", "limpeza residencial"],
  pintor: ["pintura residencial", "pintura de parede"],
  chaveiro: ["chave", "fechadura"],
};

// Keep this equivalent to normalizeServiceText in the API: lowercase, NFD, no diacritics/punctuation, compact spaces.
function normalizeAlias(text) {
  return text.trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/gu, " ").trim();
}

async function seedInitialCatalog(client) {
  const categoryIds = new Map();

  for (const category of categories) {
    const result = await client.query(
      `INSERT INTO service_categories (name, slug)
       VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [category.name, category.slug],
    );
    categoryIds.set(category.slug, result.rows[0].id);
  }

  const serviceIds = new Map();
  for (const service of services) {
    const result = await client.query(
      `INSERT INTO services (category_id, name, slug)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET category_id = EXCLUDED.category_id, name = EXCLUDED.name
       RETURNING id`,
      [categoryIds.get(service.categorySlug), service.name, service.slug],
    );
    serviceIds.set(service.slug, result.rows[0].id);
  }

  for (const [serviceSlug, aliases] of Object.entries(aliasesByServiceSlug)) {
    for (const alias of aliases) {
      await client.query(
        `INSERT INTO service_aliases (service_id, alias, normalized_alias)
         VALUES ($1, $2, $3)
         ON CONFLICT (service_id, normalized_alias) DO UPDATE SET alias = EXCLUDED.alias`,
        [serviceIds.get(serviceSlug), alias, normalizeAlias(alias)],
      );
    }
  }
}

module.exports = { seedInitialCatalog };
