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
        if (input.plan_code === "already_exists") throw new Error("subscription_already_exists");
        return mockSnapshot;
      },
      extend: async (_id, input) => {
        if (input.ends_at === "2020-01-01T00:00:00.000Z") throw new Error("invalid_extension_period");
        return mockSnapshot;
      },
      revoke: async () => mockSnapshot,
      reactivate: async (_id, input) => {
        if (input.plan_code === "not_reactivatable") throw new Error("subscription_not_reactivatable");
        if (input.plan_code === "inactive_plan") throw new Error("plan_inactive");
        return mockSnapshot;
      },
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

  // POST grant when subscription already exists -> 409
  const alreadyExistsGrant = await app.inject({
    method: "POST",
    url: `/internal/professional-subscriptions/${profileId}/grant`,
    headers,
    payload: {
      plan_code: "already_exists",
      starts_at: "2026-01-01T00:00:00.000Z",
      ends_at: "2026-12-31T00:00:00.000Z",
    },
  });
  assert.equal(alreadyExistsGrant.statusCode, 409);
  assert.deepEqual(alreadyExistsGrant.json(), { error: "subscription_already_exists" });

  // POST extend with invalid extension period
  const invalidExtend = await app.inject({
    method: "POST",
    url: `/internal/professional-subscriptions/${profileId}/extend`,
    headers,
    payload: { ends_at: "2020-01-01T00:00:00.000Z" },
  });
  assert.equal(invalidExtend.statusCode, 400);

  // POST revoke with unexpected body -> 400
  const invalidRevoke = await app.inject({
    method: "POST",
    url: `/internal/professional-subscriptions/${profileId}/revoke`,
    headers,
    payload: { unexpected: true },
  });
  assert.equal(invalidRevoke.statusCode, 400);
  assert.deepEqual(invalidRevoke.json(), { error: "invalid_request" });

  // POST revoke with null body -> 400
  const nullRevoke = await app.inject({
    method: "POST",
    url: `/internal/professional-subscriptions/${profileId}/revoke`,
    headers: { ...headers, "content-type": "application/json" },
    payload: "null",
  });
  assert.equal(nullRevoke.statusCode, 400);
  assert.deepEqual(nullRevoke.json(), { error: "invalid_request" });

  // POST revoke success
  const revokeRes = await app.inject({
    method: "POST",
    url: `/internal/professional-subscriptions/${profileId}/revoke`,
    headers,
  });
  assert.equal(revokeRes.statusCode, 200);

  // POST reactivate when subscription is not reactivatable -> 409
  const notReactivatableRes = await app.inject({
    method: "POST",
    url: `/internal/professional-subscriptions/${profileId}/reactivate`,
    headers,
    payload: {
      plan_code: "not_reactivatable",
      starts_at: "2026-06-01T00:00:00.000Z",
      ends_at: "2026-12-31T00:00:00.000Z",
    },
  });
  assert.equal(notReactivatableRes.statusCode, 409);
  assert.deepEqual(notReactivatableRes.json(), { error: "subscription_not_reactivatable" });

  // POST reactivate with inactive plan -> 409
  const inactivePlanRes = await app.inject({
    method: "POST",
    url: `/internal/professional-subscriptions/${profileId}/reactivate`,
    headers,
    payload: {
      plan_code: "inactive_plan",
      starts_at: "2026-06-01T00:00:00.000Z",
      ends_at: "2026-12-31T00:00:00.000Z",
    },
  });
  assert.equal(inactivePlanRes.statusCode, 409);
  assert.deepEqual(inactivePlanRes.json(), { error: "plan_inactive" });

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
