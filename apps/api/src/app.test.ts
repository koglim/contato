import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type {
  CreateProfessionalInput,
  ListProfessionalsQuery,
  ProfessionalResponse,
  UpdateProfessionalInput,
} from "@contatocerto/shared";
import { buildApp } from "./app.js";
import type {
  CreateProfessionalRecord,
  ProfessionalsRepository,
} from "./modules/professionals/professionals.types.js";

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
