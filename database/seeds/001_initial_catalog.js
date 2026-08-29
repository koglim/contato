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

  for (const service of services) {
    await client.query(
      `INSERT INTO services (category_id, name, slug)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET category_id = EXCLUDED.category_id, name = EXCLUDED.name`,
      [categoryIds.get(service.categorySlug), service.name, service.slug],
    );
  }
}

module.exports = { seedInitialCatalog };
