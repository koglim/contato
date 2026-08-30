import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type {
  CreateProfessionalInput,
  ListProfessionalsQuery,
  ProfessionalResponse,
  ProfessionalServiceResponse,
  ServiceAreaResponse,
  ServiceCatalogItem,
  UpdateProfessionalInput,
} from "@contatocerto/shared";
import { buildApp } from "./app.js";
import type {
  CreateProfessionalRecord,
  ProfessionalsRepository,
} from "./modules/professionals/professionals.types.js";
import type { CatalogRepository } from "./modules/catalog/catalog.types.js";
import type {
  ProfessionalServicesRepository,
  ProfessionalServiceUpdateRecord,
} from "./modules/professional-services/professional-services.types.js";
import type { ServiceAreasRepository, ServiceAreaUpdateRecord } from "./modules/service-areas/service-areas.types.js";

const internalApiKey = "test-internal-key";

class FakeProfessionalsRepository implements ProfessionalsRepository {
  private readonly professionals = new Map<string, ProfessionalResponse>();

  async create(input: CreateProfessionalRecord) {
    if ([...this.professionals.values()].some((professional) => professional.slug === input.slug)) {
      throw Object.assign(new Error("duplicate slug"), { code: "23505" });
    }

    const now = new Date().toISOString();
    const professional: ProfessionalResponse = {
      id: randomUUID(),
      display_name: input.display_name,
      slug: input.slug,
      bio: input.bio ?? null,
      phone_e164: input.phone_e164,
      email: input.email ?? null,
      profile_image_url: input.profile_image_url ?? null,
      status: "draft",
      is_verified: false,
      is_available_now: false,
      available_now_updated_at: null,
      created_at: now,
      updated_at: now,
    };

    this.professionals.set(professional.id, professional);
    return professional;
  }

  async findById(id: string) {
    return this.professionals.get(id) ?? null;
  }

  async list(filters: ListProfessionalsQuery) {
    const term = filters.q?.toLowerCase();
    const items = [...this.professionals.values()]
      .filter((professional) => !filters.status || professional.status === filters.status)
      .filter((professional) => {
        if (!term) {
          return true;
        }

        return [professional.display_name, professional.email, professional.phone_e164, professional.slug]
          .filter((value): value is string => value !== null)
          .some((value) => value.toLowerCase().includes(term));
      })
      .sort((left, right) => right.created_at.localeCompare(left.created_at));

    return {
      items: items.slice(filters.offset, filters.offset + filters.limit),
      total: items.length,
    };
  }

  async update(id: string, input: UpdateProfessionalInput) {
    const professional = this.professionals.get(id);
    if (!professional) {
      return null;
    }

    const updated = {
      ...professional,
      ...input,
      updated_at: new Date().toISOString(),
    };
    this.professionals.set(id, updated);
    return updated;
  }
}

function buildInternalApp(repository = new FakeProfessionalsRepository()) {
  return {
    app: buildApp({ professionalsRepository: repository, internalApiKey }),
    repository,
  };
}

function internalHeaders() {
  return { "x-internal-key": internalApiKey };
}

const createPayload: CreateProfessionalInput = {
  display_name: "João Elétrica",
  phone_e164: "+5565999999999",
  email: "joao@example.com",
  bio: "Eletricista residencial.",
  profile_image_url: "https://example.com/joao.jpg",
};

test("GET /health returns the service status", async () => {
  const app = buildApp();
  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });

  await app.close();
});

test("GET /health/db reports a connected database", async () => {
  const app = buildApp({ checkDatabase: async () => undefined });
  const response = await app.inject({ method: "GET", url: "/health/db" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok", database: "connected" });

  await app.close();
});

test("GET /health/db does not expose database errors", async () => {
  const app = buildApp({ checkDatabase: async () => Promise.reject(new Error("connection failed")) });
  const response = await app.inject({ method: "GET", url: "/health/db" });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { status: "error", database: "unavailable" });

  await app.close();
});

test("POST /internal/professionals creates a draft professional with a generated slug", async () => {
  const { app } = buildInternalApp();
  const response = await app.inject({
    method: "POST",
    url: "/internal/professionals",
    headers: internalHeaders(),
    payload: createPayload,
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().slug, "joao-eletrica");
  assert.equal(response.json().status, "draft");
  assert.equal(response.json().is_verified, false);

  await app.close();
});

test("POST /internal/professionals requires the internal key", async () => {
  const { app } = buildInternalApp();
  const response = await app.inject({ method: "POST", url: "/internal/professionals", payload: createPayload });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: "unauthorized" });

  await app.close();
});

test("POST /internal/professionals rejects an invalid phone", async () => {
  const { app } = buildInternalApp();
  const response = await app.inject({
    method: "POST",
    url: "/internal/professionals",
    headers: internalHeaders(),
    payload: { ...createPayload, phone_e164: "(65) 99999-9999" },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "validation_error");

  await app.close();
});

test("POST /internal/professionals appends a suffix for duplicate slugs", async () => {
  const { app } = buildInternalApp();
  await app.inject({ method: "POST", url: "/internal/professionals", headers: internalHeaders(), payload: createPayload });
  const response = await app.inject({
    method: "POST",
    url: "/internal/professionals",
    headers: internalHeaders(),
    payload: { ...createPayload, phone_e164: "+5565988888888" },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().slug, "joao-eletrica-2");

  await app.close();
});

test("GET /internal/professionals lists professionals with pagination", async () => {
  const { app } = buildInternalApp();
  await app.inject({ method: "POST", url: "/internal/professionals", headers: internalHeaders(), payload: createPayload });
  await app.inject({
    method: "POST",
    url: "/internal/professionals",
    headers: internalHeaders(),
    payload: { ...createPayload, display_name: "Maria Pintura", phone_e164: "+5565977777777" },
  });

  const response = await app.inject({
    method: "GET",
    url: "/internal/professionals?limit=1&offset=1",
    headers: internalHeaders(),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().items.length, 1);
  assert.deepEqual(response.json().pagination, { total: 2, limit: 1, offset: 1 });

  await app.close();
});

test("GET /internal/professionals/:id returns an existing professional", async () => {
  const { app } = buildInternalApp();
  const created = await app.inject({
    method: "POST",
    url: "/internal/professionals",
    headers: internalHeaders(),
    payload: createPayload,
  });
  const response = await app.inject({
    method: "GET",
    url: `/internal/professionals/${created.json().id}`,
    headers: internalHeaders(),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().id, created.json().id);

  await app.close();
});

test("GET /internal/professionals/:id returns 404 when absent", async () => {
  const { app } = buildInternalApp();
  const response = await app.inject({
    method: "GET",
    url: `/internal/professionals/${randomUUID()}`,
    headers: internalHeaders(),
  });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: "professional_not_found" });

  await app.close();
});

test("PATCH /internal/professionals/:id updates allowed fields and preserves the slug", async () => {
  const { app } = buildInternalApp();
  const created = await app.inject({
    method: "POST",
    url: "/internal/professionals",
    headers: internalHeaders(),
    payload: createPayload,
  });
  const response = await app.inject({
    method: "PATCH",
    url: `/internal/professionals/${created.json().id}`,
    headers: internalHeaders(),
    payload: { display_name: "João Serviços", email: null, status: "active" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().display_name, "João Serviços");
  assert.equal(response.json().email, null);
  assert.equal(response.json().status, "active");
  assert.equal(response.json().slug, "joao-eletrica");

  await app.close();
});

test("PATCH /internal/professionals/:id rejects forbidden fields and invalid statuses", async () => {
  const { app } = buildInternalApp();
  const created = await app.inject({
    method: "POST",
    url: "/internal/professionals",
    headers: internalHeaders(),
    payload: createPayload,
  });
  const forbidden = await app.inject({
    method: "PATCH",
    url: `/internal/professionals/${created.json().id}`,
    headers: internalHeaders(),
    payload: { slug: "not-allowed" },
  });
  const invalidStatus = await app.inject({
    method: "PATCH",
    url: `/internal/professionals/${created.json().id}`,
    headers: internalHeaders(),
    payload: { status: "deleted" },
  });

  assert.equal(forbidden.statusCode, 400);
  assert.equal(invalidStatus.statusCode, 400);

  await app.close();
});

test("PATCH /internal/professionals/:id returns 404 when absent", async () => {
  const { app } = buildInternalApp();
  const response = await app.inject({
    method: "PATCH",
    url: `/internal/professionals/${randomUUID()}`,
    headers: internalHeaders(),
    payload: { bio: "Updated bio" },
  });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: "professional_not_found" });

  await app.close();
});

const professionalId = "11111111-1111-4111-8111-111111111111";
const anotherProfessionalId = "22222222-2222-4222-8222-222222222222";
const electricianId = "33333333-3333-4333-8333-333333333333";
const plumberId = "44444444-4444-4444-8444-444444444444";
const inactiveServiceId = "55555555-5555-4555-8555-555555555555";

class FakeCatalogRepository implements CatalogRepository {
  readonly services = new Map<string, ServiceCatalogItem>([
    [
      electricianId,
      {
        id: electricianId,
        name: "Eletricista",
        slug: "eletricista",
        description: null,
        is_active: true,
        category: { id: "66666666-6666-4666-8666-666666666666", name: "Casa e Manutenção", slug: "casa-e-manutencao" },
      },
    ],
    [
      plumberId,
      {
        id: plumberId,
        name: "Encanador",
        slug: "encanador",
        description: null,
        is_active: true,
        category: { id: "66666666-6666-4666-8666-666666666666", name: "Casa e Manutenção", slug: "casa-e-manutencao" },
      },
    ],
    [
      inactiveServiceId,
      {
        id: inactiveServiceId,
        name: "Serviço inativo",
        slug: "servico-inativo",
        description: null,
        is_active: false,
        category: { id: "77777777-7777-4777-8777-777777777777", name: "Outro", slug: "outro" },
      },
    ],
  ]);

  async listServices(filters: { q?: string; category_id?: string }) {
    return [...this.services.values()]
      .filter((service) => service.is_active)
      .filter((service) => !filters.category_id || service.category.id === filters.category_id)
      .filter((service) => !filters.q || `${service.name} ${service.slug}`.toLowerCase().includes(filters.q.toLowerCase()))
      .sort((left, right) => left.category.name.localeCompare(right.category.name) || left.name.localeCompare(right.name));
  }
}

class FakeProfessionalServicesRepository implements ProfessionalServicesRepository {
  private readonly professionalIds = new Set([professionalId, anotherProfessionalId]);
  private readonly associations = new Map<string, ProfessionalServiceResponse>();

  constructor(private readonly catalog: FakeCatalogRepository) {}

  async professionalExists(id: string) {
    return this.professionalIds.has(id);
  }

  async findService(id: string) {
    const service = this.catalog.services.get(id);
    return service ? { id: service.id, is_active: service.is_active } : null;
  }

  async findByProfessionalAndService(id: string, serviceId: string) {
    return [...this.associations.values()].find((item) => item.professional_id === id && item.service_id === serviceId) ?? null;
  }

  async findById(id: string, associationId: string) {
    const association = this.associations.get(associationId);
    return association?.professional_id === id ? association : null;
  }

  async listByProfessional(id: string) {
    return [...this.associations.values()].filter((item) => item.professional_id === id);
  }

  async create(id: string, input: { service_id: string; description?: string; price_mode: "quote" | "fixed" | "from" | "range"; price_from_cents?: number; price_to_cents?: number }) {
    if (await this.findByProfessionalAndService(id, input.service_id)) {
      throw Object.assign(new Error("duplicate"), { code: "23505" });
    }
    const now = new Date().toISOString();
    const service = this.catalog.services.get(input.service_id)!;
    const association: ProfessionalServiceResponse = {
      id: randomUUID(),
      professional_id: id,
      service_id: input.service_id,
      description: input.description ?? null,
      price_mode: input.price_mode,
      price_from_cents: input.price_from_cents ?? null,
      price_to_cents: input.price_to_cents ?? null,
      is_active: true,
      service: { id: service.id, name: service.name, slug: service.slug, category: service.category },
      created_at: now,
      updated_at: now,
    };
    this.associations.set(association.id, association);
    return association;
  }

  async update(id: string, associationId: string, input: ProfessionalServiceUpdateRecord) {
    const current = await this.findById(id, associationId);
    if (!current) return null;
    const updated = { ...current, ...input, updated_at: new Date().toISOString() };
    this.associations.set(associationId, updated);
    return updated;
  }
}

function buildServicesApp() {
  const catalog = new FakeCatalogRepository();
  const services = new FakeProfessionalServicesRepository(catalog);
  return { app: buildApp({ catalogRepository: catalog, professionalServicesRepository: services, internalApiKey }), catalog, services };
}

function serviceUrl(id = professionalId) {
  return `/internal/professionals/${id}/services`;
}

test("catalog lists active services and requires the internal key", async () => {
  const { app } = buildServicesApp();
  const denied = await app.inject({ method: "GET", url: "/internal/catalog/services" });
  const response = await app.inject({ method: "GET", url: "/internal/catalog/services?q=eletri", headers: internalHeaders() });
  assert.equal(denied.statusCode, 401);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().items[0].name, "Eletricista");
  await app.close();
});

test("professional services creates quote, fixed, from and range prices", async () => {
  const { app } = buildServicesApp();
  const cases = [
    [{ service_id: electricianId, price_mode: "quote" }, "quote", null, null],
    [{ service_id: plumberId, price_mode: "fixed", price_from_cents: 12_000 }, "fixed", 12_000, null],
  ] as const;
  for (const [payload, mode, from, to] of cases) {
    const response = await app.inject({ method: "POST", url: serviceUrl(), headers: internalHeaders(), payload });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().price_mode, mode);
    assert.equal(response.json().price_from_cents, from);
    assert.equal(response.json().price_to_cents, to);
  }
  const from = await app.inject({ method: "POST", url: serviceUrl(anotherProfessionalId), headers: internalHeaders(), payload: { service_id: electricianId, price_mode: "from", price_from_cents: 15_000 } });
  const range = await app.inject({ method: "POST", url: serviceUrl(anotherProfessionalId), headers: internalHeaders(), payload: { service_id: plumberId, price_mode: "range", price_from_cents: 10_000, price_to_cents: 30_000 } });
  assert.equal(from.statusCode, 201);
  assert.equal(range.statusCode, 201);
  await app.close();
});

test("professional services validates price rules before persistence", async () => {
  const { app } = buildServicesApp();
  const decimal = await app.inject({ method: "POST", url: serviceUrl(), headers: internalHeaders(), payload: { service_id: electricianId, price_mode: "fixed", price_from_cents: 150.5 } });
  const invalidRange = await app.inject({ method: "POST", url: serviceUrl(), headers: internalHeaders(), payload: { service_id: electricianId, price_mode: "range", price_from_cents: 300, price_to_cents: 100 } });
  assert.equal(decimal.statusCode, 400);
  assert.equal(invalidRange.statusCode, 400);
  await app.close();
});

test("professional services reports absent professionals, services and inactive catalog services", async () => {
  const { app } = buildServicesApp();
  const missingProfessional = await app.inject({ method: "POST", url: serviceUrl(randomUUID()), headers: internalHeaders(), payload: { service_id: electricianId, price_mode: "quote" } });
  const missingService = await app.inject({ method: "POST", url: serviceUrl(), headers: internalHeaders(), payload: { service_id: randomUUID(), price_mode: "quote" } });
  const inactive = await app.inject({ method: "POST", url: serviceUrl(), headers: internalHeaders(), payload: { service_id: inactiveServiceId, price_mode: "quote" } });
  assert.deepEqual(missingProfessional.json(), { error: "professional_not_found" });
  assert.deepEqual(missingService.json(), { error: "service_not_found" });
  assert.deepEqual(inactive.json(), { error: "service_inactive" });
  await app.close();
});

test("professional services rejects active duplicates and reactivates inactive associations", async () => {
  const { app } = buildServicesApp();
  const created = await app.inject({ method: "POST", url: serviceUrl(), headers: internalHeaders(), payload: { service_id: electricianId, price_mode: "quote" } });
  const duplicate = await app.inject({ method: "POST", url: serviceUrl(), headers: internalHeaders(), payload: { service_id: electricianId, price_mode: "quote" } });
  await app.inject({ method: "PATCH", url: `${serviceUrl()}/${created.json().id}`, headers: internalHeaders(), payload: { is_active: false } });
  const reactivated = await app.inject({ method: "POST", url: serviceUrl(), headers: internalHeaders(), payload: { service_id: electricianId, price_mode: "from", price_from_cents: 15_000 } });
  assert.deepEqual(duplicate.json(), { error: "professional_service_already_exists" });
  assert.equal(reactivated.statusCode, 200);
  assert.equal(reactivated.json().id, created.json().id);
  assert.equal(reactivated.json().is_active, true);
  await app.close();
});

test("professional services lists empty and populated associations", async () => {
  const { app } = buildServicesApp();
  const empty = await app.inject({ method: "GET", url: serviceUrl(), headers: internalHeaders() });
  await app.inject({ method: "POST", url: serviceUrl(), headers: internalHeaders(), payload: { service_id: electricianId, price_mode: "quote" } });
  const populated = await app.inject({ method: "GET", url: serviceUrl(), headers: internalHeaders() });
  assert.deepEqual(empty.json(), { items: [] });
  assert.equal(populated.json().items[0].service.category.name, "Casa e Manutenção");
  await app.close();
});

test("professional services patch updates description, prices and clears quote prices", async () => {
  const { app } = buildServicesApp();
  const created = await app.inject({ method: "POST", url: serviceUrl(), headers: internalHeaders(), payload: { service_id: electricianId, price_mode: "range", price_from_cents: 100, price_to_cents: 300 } });
  const id = created.json().id;
  const changed = await app.inject({ method: "PATCH", url: `${serviceUrl()}/${id}`, headers: internalHeaders(), payload: { description: "Instalação elétrica", price_from_cents: 150 } });
  const quote = await app.inject({ method: "PATCH", url: `${serviceUrl()}/${id}`, headers: internalHeaders(), payload: { price_mode: "quote" } });
  assert.equal(changed.json().description, "Instalação elétrica");
  assert.equal(changed.json().price_from_cents, 150);
  assert.equal(quote.json().price_from_cents, null);
  assert.equal(quote.json().price_to_cents, null);
  await app.close();
});

test("professional services patch requires final prices, supports activation and enforces ownership", async () => {
  const { app, catalog } = buildServicesApp();
  const created = await app.inject({ method: "POST", url: serviceUrl(), headers: internalHeaders(), payload: { service_id: electricianId, price_mode: "quote" } });
  const id = created.json().id;
  const missingPrice = await app.inject({ method: "PATCH", url: `${serviceUrl()}/${id}`, headers: internalHeaders(), payload: { price_mode: "from" } });
  const disabled = await app.inject({ method: "PATCH", url: `${serviceUrl()}/${id}`, headers: internalHeaders(), payload: { is_active: false } });
  const reactivated = await app.inject({ method: "PATCH", url: `${serviceUrl()}/${id}`, headers: internalHeaders(), payload: { is_active: true } });
  await app.inject({ method: "PATCH", url: `${serviceUrl()}/${id}`, headers: internalHeaders(), payload: { is_active: false } });
  catalog.services.set(electricianId, { ...catalog.services.get(electricianId)!, is_active: false });
  const blocked = await app.inject({ method: "PATCH", url: `${serviceUrl()}/${id}`, headers: internalHeaders(), payload: { is_active: true } });
  const otherProfessional = await app.inject({ method: "PATCH", url: `${serviceUrl(anotherProfessionalId)}/${id}`, headers: internalHeaders(), payload: { is_active: false } });
  const emptyBody = await app.inject({ method: "PATCH", url: `${serviceUrl()}/${id}`, headers: internalHeaders(), payload: {} });
  assert.equal(missingPrice.statusCode, 400);
  assert.equal(disabled.json().is_active, false);
  assert.equal(reactivated.json().is_active, true);
  assert.deepEqual(blocked.json(), { error: "service_inactive" });
  assert.deepEqual(otherProfessional.json(), { error: "professional_service_not_found" });
  assert.equal(emptyBody.statusCode, 400);
  await app.close();
});

test("new internal routes reject requests when no internal key is configured", async () => {
  const catalog = new FakeCatalogRepository();
  const services = new FakeProfessionalServicesRepository(catalog);
  const app = buildApp({ catalogRepository: catalog, professionalServicesRepository: services });
  const catalogResponse = await app.inject({ method: "GET", url: "/internal/catalog/services" });
  const serviceResponse = await app.inject({ method: "GET", url: serviceUrl() });
  assert.equal(catalogResponse.statusCode, 401);
  assert.equal(serviceResponse.statusCode, 401);
  await app.close();
});

class FakeServiceAreasRepository implements ServiceAreasRepository {
  private readonly professionalIds = new Set([professionalId, anotherProfessionalId]);
  private readonly areas = new Map<string, ServiceAreaResponse>();

  async professionalExists(id: string) {
    return this.professionalIds.has(id);
  }

  async listByProfessional(id: string) {
    return [...this.areas.values()]
      .filter((area) => area.professional_id === id)
      .sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || left.created_at.localeCompare(right.created_at));
  }

  async findById(id: string, areaId: string) {
    const area = this.areas.get(areaId);
    return area?.professional_id === id ? area : null;
  }

  async create(id: string, input: { label?: string; city: string; state: string; country_code: string; neighborhood?: string | null; latitude: number; longitude: number; radius_meters: number; is_primary: boolean }) {
    if (input.is_primary) this.clearPrimary(id);
    const now = new Date().toISOString();
    const area: ServiceAreaResponse = { id: randomUUID(), professional_id: id, label: input.label ?? null, city: input.city, state: input.state, country_code: input.country_code, neighborhood: input.neighborhood ?? null, latitude: input.latitude, longitude: input.longitude, radius_meters: input.radius_meters, is_primary: input.is_primary, created_at: now, updated_at: now };
    this.areas.set(area.id, area);
    return area;
  }

  async update(id: string, areaId: string, input: ServiceAreaUpdateRecord) {
    const current = await this.findById(id, areaId);
    if (!current) return null;
    if (input.is_primary) this.clearPrimary(id);
    const updated = { ...current, ...input, updated_at: new Date().toISOString() };
    this.areas.set(areaId, updated);
    return updated;
  }

  async delete(id: string, areaId: string) {
    if (!(await this.findById(id, areaId))) return false;
    this.areas.delete(areaId);
    return true;
  }

  private clearPrimary(id: string) {
    for (const [areaId, area] of this.areas) {
      if (area.professional_id === id && area.is_primary) this.areas.set(areaId, { ...area, is_primary: false });
    }
  }
}

function buildAreasApp() {
  const repository = new FakeServiceAreasRepository();
  return { app: buildApp({ serviceAreasRepository: repository, internalApiKey }), repository };
}

function areasUrl(id = professionalId) {
  return `/internal/professionals/${id}/service-areas`;
}

const areaPayload = { label: "Sinop e região", city: "Sinop", state: "MT", country_code: "br", neighborhood: null, latitude: -11.8608, longitude: -55.5091, radius_meters: 30_000, is_primary: true };

test("service areas require a key, identify missing professionals and list empty areas", async () => {
  const { app } = buildAreasApp();
  const denied = await app.inject({ method: "GET", url: areasUrl() });
  const absent = await app.inject({ method: "GET", url: areasUrl(randomUUID()), headers: internalHeaders() });
  const empty = await app.inject({ method: "GET", url: areasUrl(), headers: internalHeaders() });
  assert.equal(denied.statusCode, 401);
  assert.deepEqual(absent.json(), { error: "professional_not_found" });
  assert.deepEqual(empty.json(), { items: [] });
  await app.close();
});

test("service areas creates validated coordinates, normalizes country and orders primary first", async () => {
  const { app } = buildAreasApp();
  const first = await app.inject({ method: "POST", url: areasUrl(), headers: internalHeaders(), payload: areaPayload });
  const second = await app.inject({ method: "POST", url: areasUrl(), headers: internalHeaders(), payload: { ...areaPayload, label: "Bairro", latitude: -11.8, is_primary: false } });
  const listed = await app.inject({ method: "GET", url: areasUrl(), headers: internalHeaders() });
  assert.equal(first.statusCode, 201);
  assert.equal(first.json().country_code, "BR");
  assert.equal(first.json().latitude, -11.8608);
  assert.equal(first.json().longitude, -55.5091);
  assert.equal(second.statusCode, 201);
  assert.equal(listed.json().items[0].id, first.json().id);
  await app.close();
});

test("service areas rejects invalid coordinate and radius ranges", async () => {
  const { app } = buildAreasApp();
  for (const payload of [
    { ...areaPayload, latitude: -91 }, { ...areaPayload, latitude: 91 }, { ...areaPayload, longitude: -181 },
    { ...areaPayload, longitude: 181 }, { ...areaPayload, radius_meters: 0 }, { ...areaPayload, radius_meters: 200_001 },
  ]) {
    const response = await app.inject({ method: "POST", url: areasUrl(), headers: internalHeaders(), payload });
    assert.equal(response.statusCode, 400);
  }
  await app.close();
});

test("creating a new primary service area demotes the previous primary", async () => {
  const { app } = buildAreasApp();
  const first = await app.inject({ method: "POST", url: areasUrl(), headers: internalHeaders(), payload: areaPayload });
  const second = await app.inject({ method: "POST", url: areasUrl(), headers: internalHeaders(), payload: { ...areaPayload, label: "Nova primária", is_primary: true } });
  const listed = await app.inject({ method: "GET", url: areasUrl(), headers: internalHeaders() });
  assert.equal(second.json().is_primary, true);
  assert.equal(listed.json().items.find((item: { id: string }) => item.id === first.json().id).is_primary, false);
  await app.close();
});

test("service area patch updates texts, radius and coordinates from final state", async () => {
  const { app } = buildAreasApp();
  const created = await app.inject({ method: "POST", url: areasUrl(), headers: internalHeaders(), payload: areaPayload });
  const url = `${areasUrl()}/${created.json().id}`;
  const label = await app.inject({ method: "PATCH", url, headers: internalHeaders(), payload: { label: "Sinop centro", radius_meters: 10_000 } });
  const latitude = await app.inject({ method: "PATCH", url, headers: internalHeaders(), payload: { latitude: -12 } });
  const longitude = await app.inject({ method: "PATCH", url, headers: internalHeaders(), payload: { longitude: -56 } });
  const both = await app.inject({ method: "PATCH", url, headers: internalHeaders(), payload: { latitude: -10, longitude: -54 } });
  assert.equal(label.json().radius_meters, 10_000);
  assert.equal(latitude.json().longitude, -55.5091);
  assert.equal(longitude.json().latitude, -12);
  assert.deepEqual([both.json().latitude, both.json().longitude], [-10, -54]);
  await app.close();
});

test("service area patch manages primary state, validates body and protects ownership", async () => {
  const { app } = buildAreasApp();
  const first = await app.inject({ method: "POST", url: areasUrl(), headers: internalHeaders(), payload: areaPayload });
  const second = await app.inject({ method: "POST", url: areasUrl(), headers: internalHeaders(), payload: { ...areaPayload, label: "Outra", is_primary: false } });
  const makePrimary = await app.inject({ method: "PATCH", url: `${areasUrl()}/${second.json().id}`, headers: internalHeaders(), payload: { is_primary: true } });
  const demote = await app.inject({ method: "PATCH", url: `${areasUrl()}/${second.json().id}`, headers: internalHeaders(), payload: { is_primary: false } });
  const empty = await app.inject({ method: "PATCH", url: `${areasUrl()}/${second.json().id}`, headers: internalHeaders(), payload: {} });
  const missing = await app.inject({ method: "PATCH", url: `${areasUrl()}/${randomUUID()}`, headers: internalHeaders(), payload: { label: "x" } });
  const other = await app.inject({ method: "PATCH", url: `${areasUrl(anotherProfessionalId)}/${first.json().id}`, headers: internalHeaders(), payload: { label: "x" } });
  assert.equal(makePrimary.json().is_primary, true);
  assert.equal(demote.json().is_primary, false);
  assert.equal(empty.statusCode, 400);
  assert.deepEqual(missing.json(), { error: "service_area_not_found" });
  assert.deepEqual(other.json(), { error: "service_area_not_found" });
  await app.close();
});

test("service area delete returns 204 and rejects missing or foreign areas", async () => {
  const { app } = buildAreasApp();
  const created = await app.inject({ method: "POST", url: areasUrl(), headers: internalHeaders(), payload: areaPayload });
  const foreign = await app.inject({ method: "DELETE", url: `${areasUrl(anotherProfessionalId)}/${created.json().id}`, headers: internalHeaders() });
  const deleted = await app.inject({ method: "DELETE", url: `${areasUrl()}/${created.json().id}`, headers: internalHeaders() });
  const missing = await app.inject({ method: "DELETE", url: `${areasUrl()}/${created.json().id}`, headers: internalHeaders() });
  assert.deepEqual(foreign.json(), { error: "service_area_not_found" });
  assert.equal(deleted.statusCode, 204);
  assert.deepEqual(missing.json(), { error: "service_area_not_found" });
  await app.close();
});
