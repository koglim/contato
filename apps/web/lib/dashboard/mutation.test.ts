import assert from "node:assert/strict";
import { test } from "node:test";
import { handleDashboardMutation } from "./mutation";

const owner = "65ab5b6c-4f2c-4f23-a7d0-7bc141d94cc0";
const item = "558e4b09-3a17-49be-b3bb-d461a0d3e862";
const request = (body: unknown, method = "PATCH", contentType = "application/json") => new Request("http://localhost/api/dashboard", {
  method, headers: { "content-type": contentType }, body: JSON.stringify(body),
});
function boundary(authorized = true) {
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const dependencies = {
    authorize: async () => { if (!authorized) throw new Error("dashboard_unauthorized"); },
    professionalId: () => owner,
    api: async (path: string, init: RequestInit) => { calls.push({ path, init }); return { ok: true }; },
  };
  return { calls, send: (input: Request) => handleDashboardMutation(input, dependencies) };
}

test("dashboard HTTP mutation authenticates before forwarding, including malformed input", async () => {
  const f = boundary(false);
  for (const payload of [null, { action: "profile", data: { display_name: "Ana" } }]) {
    assert.equal((await f.send(request(payload))).status, 401);
  }
  assert.equal(f.calls.length, 0);
});

test("self-service cannot mutate status, verification, identity or ownership even with a valid session", async () => {
  const f = boundary();
  const forbidden = { status: "active", is_verified: true, phone_e164: "+5566999999999", user_id: item, professional_id: item, slug: "ana", role: "admin" };
  for (const [field, value] of Object.entries(forbidden)) {
    const response = await f.send(request({ action: "profile", data: { display_name: "Ana", [field]: value } }));
    assert.equal(response.status, 400, field);
    assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  assert.equal(f.calls.length, 0);
});

test("profile allowlist forwards only permitted fields under the server-owned professional", async () => {
  const f = boundary();
  const data = { display_name: " Ana Souza ", bio: "Eletricista", email: null, profile_image_url: null };
  assert.equal((await f.send(request({ action: "profile", data }))).status, 200);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].path, `/internal/professionals/${owner}`);
  assert.equal(f.calls[0].init.method, "PATCH");
  assert.deepEqual(JSON.parse(f.calls[0].init.body as string), { ...data, display_name: "Ana Souza" });
});

test("dashboard rejects method confusion, unknown actions, path injection and supplied ownership", async () => {
  const f = boundary();
  const invalid = [
    request({ action: "profile", data: { display_name: "Ana" } }, "DELETE"),
    request({ action: "profile", data: { display_name: "Ana" } }, "POST"),
    request({ action: "constructor", data: {} }),
    request({ action: "area", id: "../../other", data: { city: "Sinop" } }),
    request({ action: "area", data: { city: "Sinop" } }),
    request({ action: "profile", id: item, data: { display_name: "Ana" } }),
    request({ action: "profile", professional_id: item, data: { display_name: "Ana" } }),
    request({ action: "profile", method: "DELETE", data: { display_name: "Ana" } }),
    request({ action: "profile", data: {} }),
    request({ action: "availability", data: { is_available_now: "true" } }),
    request({ action: "availability", data: { is_available_now: true } }, "PATCH", "text/plain"),
  ];
  for (const input of invalid) assert.equal((await f.send(input)).status, 400);
  assert.equal(f.calls.length, 0);
});

test("existing availability, service and area operations keep their verbs and scoped paths", async () => {
  const f = boundary();
  const area = { city: "Sinop", state: "MT", country_code: "BR", latitude: -11.8, longitude: -55.5, radius_meters: 40000 };
  const operations = [
    { method: "PATCH", payload: { action: "availability", data: { is_available_now: true } }, suffix: "/availability" },
    { method: "POST", payload: { action: "service", data: { service_id: item, price_mode: "quote" } }, suffix: "/services" },
    { method: "PATCH", payload: { action: "service", id: item, data: { is_active: false } }, suffix: `/services/${item}` },
    { method: "POST", payload: { action: "area", data: area }, suffix: "/service-areas" },
    { method: "PATCH", payload: { action: "area", id: item, data: { city: "Sinop" } }, suffix: `/service-areas/${item}` },
    { method: "DELETE", payload: { action: "area", id: item }, suffix: `/service-areas/${item}` },
  ];
  for (const operation of operations) {
    assert.equal((await f.send(request(operation.payload, operation.method))).status, 200);
    assert.equal(f.calls.at(-1)?.path, `/internal/professionals/${owner}${operation.suffix}`);
    assert.equal(f.calls.at(-1)?.init.method, operation.method);
  }
  assert.equal(f.calls.at(-1)?.init.body, undefined);
});

test("upstream failures never leak internal URL, credentials or arbitrary errors", async () => {
  const response = await handleDashboardMutation(request({ action: "profile", data: { bio: "Eletricista" } }), {
    authorize: async () => {}, professionalId: () => owner,
    api: async () => { throw new Error("https://internal.invalid key=secret phone=private"); },
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Não foi possível salvar suas alterações." });
});

test("passwordless mutations use only the authenticated self-service boundary", async () => {
  const calls: string[] = [];
  const response = await handleDashboardMutation(request({ action: "profile", data: { bio: "Eletricista" } }), {
    authorize: async () => {},
    professionalId: () => owner,
    professionalBase: id => `/profiles/${id}`,
    api: async path => { calls.push(path); return { ok: true }; },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [`/profiles/${owner}`]);
  assert.equal(calls.some(path => path.startsWith("/internal/professionals/")), false);
});

test("revoked membership is returned as forbidden on the next mutation", async () => {
  const response = await handleDashboardMutation(request({ action: "availability", data: { is_available_now: true } }), {
    authorize: async () => {},
    professionalId: () => owner,
    professionalBase: id => `/profiles/${id}`,
    api: async () => { throw new Error("professional_forbidden"); },
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "forbidden" });
});
