import assert from "node:assert/strict";
import Fastify from "fastify";
import test from "node:test";
import { professionalAuthRoutes } from "./professional-auth.routes.js";

const profileA = "11111111-1111-4111-8111-111111111111";
const profileB = "22222222-2222-4222-8222-222222222222";
const now = new Date().toISOString();

test("self-service revalidates exact membership on every read and mutation", async () => {
  const app = Fastify();
  let membershipActive = true;
  let accountActive = true;
  const checks: string[] = [];
  const service = {
    requestChallenge: async () => ({ accepted: true, challenge_reference: "", expires_in_seconds: 300 }),
    verify: async () => ({ ok: false as const }),
    authenticate: async (token: string | undefined) => token === "session" && accountActive
      ? { sessionId: "session-id", accountId: "account-a", expiresAt: new Date(Date.now() + 60_000) }
      : null,
    revoke: async () => true,
  };
  const accessService = {
    resolveProfessionalAccess: async ({ professionalId }: { accountId: string; professionalId: string }) => {
      checks.push(professionalId);
      return membershipActive && professionalId === profileA ? { status: "authorized" as const, role: "owner" as const } : { status: "not_member" as const };
    },
  };
  const eligibility = { policy_version: "eligibility-v1" as const, professional_id: profileA, identity_verified: true,
    profile_complete: true, has_active_service: false, has_service_area: false, profile_status: "draft" as const,
    ready_to_publish: false, can_appear_in_matching: false, can_receive_opportunities: false,
    can_set_available_now: false, reasons: ["no_active_service" as const, "no_service_area" as const, "profile_draft" as const] };
  const eligibilityService = { get: async () => eligibility, publish: async () => { throw new Error("unused"); },
    unpublish: async () => { throw new Error("unused"); }, updateAvailability: async () => { throw new Error("unused"); } };
  app.get("/internal/professionals/:id", async request => ({ id: (request.params as { id: string }).id, display_name: "A", slug: "a",
    bio: null, phone_e164: "+5566999999999", email: null, profile_image_url: null, status: "draft", is_verified: false,
    is_available_now: false, available_now_updated_at: null, created_at: now, updated_at: now }));
  app.get("/internal/professionals/:id/services", async () => ({ items: [] }));
  app.get("/internal/professionals/:id/service-areas", async () => ({ items: [] }));
  app.get("/internal/catalog/services", async () => ({ items: [] }));
  app.patch("/internal/professionals/:id", async request => ({ ...(request.body as object), id: (request.params as { id: string }).id }));
  await app.register(professionalAuthRoutes, { prefix: "/internal/professional-auth", internalApiKey: "key", service, accessService, eligibilityService });

  const headers = { "x-internal-key": "key", authorization: "Bearer session" };
  const readA = await app.inject({ method: "GET", url: `/internal/professional-auth/profiles/${profileA}/dashboard`, headers });
  assert.equal(readA.statusCode, 200);
  assert.equal((readA.json() as { professional: { id: string } }).professional.id, profileA);
  assert.equal((await app.inject({ method: "GET", url: `/internal/professional-auth/profiles/${profileB}/dashboard`, headers })).statusCode, 403);
  const allowed = await app.inject({ method: "PATCH", url: `/internal/professional-auth/profiles/${profileA}`, headers, payload: { display_name: "Novo nome" } });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.json().display_name, "Novo nome");

  const forbiddenProfileUpdates = [
    { status: "active" },
    { status: "draft" },
    { phone_e164: "+5566999999999" },
    { is_verified: true },
    { is_available_now: true },
    { slug: "forcado" },
    { role: "owner" },
    { professional_id: profileA },
    { display_name: "Novo", status: "active" },
  ];
  for (const payload of forbiddenProfileUpdates) {
    const response = await app.inject({ method: "PATCH", url: `/internal/professional-auth/profiles/${profileA}`, headers, payload });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
    assert.deepEqual(response.json(), { error: "invalid_request" });
  }

  membershipActive = false;
  assert.equal((await app.inject({ method: "GET", url: `/internal/professional-auth/profiles/${profileA}/dashboard`, headers })).statusCode, 403);
  assert.equal((await app.inject({ method: "PATCH", url: `/internal/professional-auth/profiles/${profileA}`, headers, payload: { display_name: "Negado" } })).statusCode, 403);

  accountActive = false;
  assert.equal((await app.inject({ method: "GET", url: `/internal/professional-auth/profiles/${profileA}/dashboard`, headers })).statusCode, 401);
  assert.equal(checks.filter(id => id === profileA).length, 13);
  assert.equal(checks.filter(id => id === profileB).length, 1);
  await app.close();
});

test("claim routes handle list and claim conflict mapping", async () => {
  const app = Fastify();
  let claimBehavior: "success" | "conflict" | "forbidden" | "not_found" = "success";
  const service = {
    requestChallenge: async () => ({ accepted: true, challenge_reference: "", expires_in_seconds: 300 }),
    verify: async () => ({ ok: false as const }),
    authenticate: async (token: string | undefined) => token === "session"
      ? { sessionId: "session-id", accountId: "account-a", expiresAt: new Date(Date.now() + 60_000) }
      : null,
    revoke: async () => true,
    listClaimableProfiles: async () => [
      { id: profileA, display_name: "Profile A", slug: "profile-a", status: "active" as const },
    ],
    claimProfile: async (_accountId: string, professionalId: string) => {
      if (claimBehavior === "conflict") throw new Error("claim_conflict");
      if (claimBehavior === "forbidden") throw new Error("claim_forbidden");
      if (claimBehavior === "not_found") throw new Error("professional_not_found");
      return {
        claimed: true as const,
        professional: { id: professionalId, display_name: "Profile A", slug: "profile-a", status: "active" as const },
      };
    },
  };
  await app.register(professionalAuthRoutes, { prefix: "/internal/professional-auth", internalApiKey: "key", service });

  const headers = { "x-internal-key": "key", authorization: "Bearer session" };

  const listRes = await app.inject({ method: "GET", url: "/internal/professional-auth/claimable-profiles", headers });
  assert.equal(listRes.statusCode, 200);
  assert.deepEqual(listRes.json(), {
    items: [{ id: profileA, display_name: "Profile A", slug: "profile-a", status: "active" }],
  });

  claimBehavior = "success";
  const claimRes = await app.inject({ method: "POST", url: `/internal/professional-auth/profiles/${profileA}/claim`, headers });
  assert.equal(claimRes.statusCode, 200);
  assert.deepEqual(claimRes.json(), {
    claimed: true,
    professional: { id: profileA, display_name: "Profile A", slug: "profile-a", status: "active" },
  });

  claimBehavior = "conflict";
  const conflictRes = await app.inject({ method: "POST", url: `/internal/professional-auth/profiles/${profileA}/claim`, headers });
  assert.equal(conflictRes.statusCode, 409);
  assert.deepEqual(conflictRes.json(), { error: "claim_conflict" });

  claimBehavior = "forbidden";
  const forbiddenRes = await app.inject({ method: "POST", url: `/internal/professional-auth/profiles/${profileA}/claim`, headers });
  assert.equal(forbiddenRes.statusCode, 403);
  assert.deepEqual(forbiddenRes.json(), { error: "forbidden" });

  claimBehavior = "not_found";
  const notFoundRes = await app.inject({ method: "POST", url: `/internal/professional-auth/profiles/${profileA}/claim`, headers });
  assert.equal(notFoundRes.statusCode, 404);
  assert.deepEqual(notFoundRes.json(), { error: "professional_not_found" });

  await app.close();
});
