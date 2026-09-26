import assert from "node:assert/strict";
import Fastify from "fastify";
import test from "node:test";
import { professionalAuthRoutes } from "./professional-auth.routes.js";

const profileA = "11111111-1111-4111-8111-111111111111";
const profileB = "22222222-2222-4222-8222-222222222222";

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
      return { status: membershipActive && professionalId === profileA ? "authorized" as const : "not_member" as const };
    },
  };
  app.get("/internal/professionals/:id", async request => ({ id: (request.params as { id: string }).id, display_name: "A" }));
  app.get("/internal/professionals/:id/services", async () => ({ items: [] }));
  app.get("/internal/professionals/:id/service-areas", async () => ({ items: [] }));
  app.get("/internal/catalog/services", async () => ({ items: [] }));
  app.patch("/internal/professionals/:id", async request => ({ ...(request.body as object), id: (request.params as { id: string }).id }));
  await app.register(professionalAuthRoutes, { prefix: "/internal/professional-auth", internalApiKey: "key", service, accessService });

  const headers = { "x-internal-key": "key", authorization: "Bearer session" };
  const readA = await app.inject({ method: "GET", url: `/internal/professional-auth/profiles/${profileA}/dashboard`, headers });
  assert.equal(readA.statusCode, 200);
  assert.equal((readA.json() as { professional: { id: string } }).professional.id, profileA);
  assert.equal((await app.inject({ method: "GET", url: `/internal/professional-auth/profiles/${profileB}/dashboard`, headers })).statusCode, 403);
  assert.equal((await app.inject({ method: "PATCH", url: `/internal/professional-auth/profiles/${profileA}`, headers, payload: { display_name: "Novo" } })).statusCode, 200);

  membershipActive = false;
  assert.equal((await app.inject({ method: "GET", url: `/internal/professional-auth/profiles/${profileA}/dashboard`, headers })).statusCode, 403);
  assert.equal((await app.inject({ method: "PATCH", url: `/internal/professional-auth/profiles/${profileA}`, headers, payload: { display_name: "Negado" } })).statusCode, 403);

  accountActive = false;
  assert.equal((await app.inject({ method: "GET", url: `/internal/professional-auth/profiles/${profileA}/dashboard`, headers })).statusCode, 401);
  assert.deepEqual(checks, [profileA, profileB, profileA, profileA, profileA]);
  await app.close();
});
