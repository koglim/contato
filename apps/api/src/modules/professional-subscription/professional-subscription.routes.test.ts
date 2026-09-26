import assert from "node:assert/strict";
import Fastify from "fastify";
import test from "node:test";
import { professionalSubscriptionsRoutes } from "./professional-subscription.routes.js";
import type { ProfessionalEntitlementSnapshot } from "@contatocerto/shared";

const profileId = "11111111-1111-4111-8111-111111111111";
const mockSnapshot: ProfessionalEntitlementSnapshot = {
  policy_version: "entitlement-v1",
  professional_id: profileId,
  management_mode: "account_managed",
  subscription_required: true,
  state: "active",
  plan_code: "marketplace_standard_v1",
  starts_at: "2026-01-01T00:00:00.000Z",
  ends_at: "2026-12-31T00:00:00.000Z",
  has_marketplace_access: true,
  reasons: [],
};

test("internal professional subscriptions routes require x-internal-key", async () => {
  const app = Fastify();
  await app.register(professionalSubscriptionsRoutes, {
    prefix: "/internal/professional-subscriptions",
    internalApiKey: "secret-key",
    service: {
      getEntitlementSnapshot: async () => mockSnapshot,
      grant: async () => mockSnapshot,
      extend: async () => mockSnapshot,
      revoke: async () => mockSnapshot,
      reactivate: async () => mockSnapshot,
    },
  });

  const resWithoutKey = await app.inject({
    method: "GET",
    url: `/internal/professional-subscriptions/${profileId}`,
  });
  assert.equal(resWithoutKey.statusCode, 401);

  const resWithWrongKey = await app.inject({
    method: "GET",
    url: `/internal/professional-subscriptions/${profileId}`,
    headers: { "x-internal-key": "wrong" },
  });
  assert.equal(resWithWrongKey.statusCode, 401);

  const resWithKey = await app.inject({
    method: "GET",
    url: `/internal/professional-subscriptions/${profileId}`,
    headers: { "x-internal-key": "secret-key" },
  });
  assert.equal(resWithKey.statusCode, 200);
  assert.deepEqual(resWithKey.json(), mockSnapshot);
});

test("internal professional subscriptions routes validate inputs and handle errors", async () => {
  const app = Fastify();
  await app.register(professionalSubscriptionsRoutes, {
    prefix: "/internal/professional-subscriptions",
    internalApiKey: "secret-key",
    service: {
      getEntitlementSnapshot: async (id) => {
        if (id === profileId) return mockSnapshot;
        throw new Error("professional_not_found");
      },
      grant: async (_id, input) => {
        if (input.plan_code === "unknown") throw new Error("plan_not_found");
        return mockSnapshot;
      },
      extend: async (_id, input) => {
        if (input.ends_at === "2020-01-01T00:00:00.000Z") throw new Error("invalid_extension_period");
        return mockSnapshot;
      },
      revoke: async () => mockSnapshot,
      reactivate: async () => mockSnapshot,
    },
  });

  const headers = { "x-internal-key": "secret-key" };

  // GET with invalid UUID
  assert.equal(
    (await app.inject({ method: "GET", url: "/internal/professional-subscriptions/not-a-uuid", headers })).statusCode,
    400,
  );

  // GET 404 for unknown professional
  const unknownId = "22222222-2222-4222-8222-222222222222";
  assert.equal(
    (await app.inject({ method: "GET", url: `/internal/professional-subscriptions/${unknownId}`, headers })).statusCode,
    404,
  );

  // POST grant with ends_at before starts_at
  const invalidGrant = await app.inject({
    method: "POST",
    url: `/internal/professional-subscriptions/${profileId}/grant`,
    headers,
    payload: {
      plan_code: "marketplace_standard_v1",
      starts_at: "2026-12-31T00:00:00.000Z",
      ends_at: "2026-01-01T00:00:00.000Z",
    },
  });
  assert.equal(invalidGrant.statusCode, 400);

  // POST grant with unknown plan
  const unknownPlanGrant = await app.inject({
    method: "POST",
    url: `/internal/professional-subscriptions/${profileId}/grant`,
    headers,
    payload: {
      plan_code: "unknown",
      starts_at: "2026-01-01T00:00:00.000Z",
      ends_at: "2026-12-31T00:00:00.000Z",
    },
  });
  assert.equal(unknownPlanGrant.statusCode, 404);

  // POST extend with invalid extension period
  const invalidExtend = await app.inject({
    method: "POST",
    url: `/internal/professional-subscriptions/${profileId}/extend`,
    headers,
    payload: { ends_at: "2020-01-01T00:00:00.000Z" },
  });
  assert.equal(invalidExtend.statusCode, 400);

  // POST revoke success
  const revokeRes = await app.inject({
    method: "POST",
    url: `/internal/professional-subscriptions/${profileId}/revoke`,
    headers,
  });
  assert.equal(revokeRes.statusCode, 200);

  // POST reactivate success
  const reactivateRes = await app.inject({
    method: "POST",
    url: `/internal/professional-subscriptions/${profileId}/reactivate`,
    headers,
    payload: {
      starts_at: "2026-06-01T00:00:00.000Z",
      ends_at: "2026-12-31T00:00:00.000Z",
    },
  });
  assert.equal(reactivateRes.statusCode, 200);
});
