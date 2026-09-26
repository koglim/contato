import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import Fastify from "fastify";
import { closeDatabaseConnection, inDatabaseTransaction, query, withTransaction, type DatabaseClient } from "../src/database/connection.js";
import { PostgresMatchingRepository } from "../src/modules/matching/matching.repository.js";
import { PostgresProfessionalEligibilityRepository } from "../src/modules/professional-eligibility/professional-eligibility.repository.js";
import { ProfessionalEligibilityService } from "../src/modules/professional-eligibility/professional-eligibility.service.js";
import { professionalAuthRoutes } from "../src/modules/professional-auth/professional-auth.routes.js";
import { PostgresProfessionalOnboardingRepository } from "../src/modules/professional-onboarding/professional-onboarding.repository.js";
import { ProfessionalOnboardingService } from "../src/modules/professional-onboarding/professional-onboarding.service.js";

after(closeDatabaseConnection);

async function fixture(client: DatabaseClient) {
  const accountId = randomUUID();
  await client.query("INSERT INTO accounts(id) VALUES($1)", [accountId]);
  const phone = `+55${randomUUID().replace(/\D/gu, "").padEnd(11, "7").slice(0, 11)}`;
  await client.query("INSERT INTO account_identifiers(account_id,kind,normalized_value,verified_at) VALUES($1,'phone',$2,NOW())", [accountId, phone]);
  return accountId;
}

async function rolledBack(operation: (client: DatabaseClient) => Promise<void>) {
  const marker = new Error("professional_onboarding_test_rollback");
  try { await withTransaction(async client => { await operation(client); throw marker; }); }
  catch (error) { if (error !== marker) throw error; }
}

test("self onboarding atomically creates draft profile, owner membership and provenance without leaking context", async () => {
  await rolledBack(async client => {
    const tx = <T>(callback: (db: DatabaseClient) => Promise<T>) => inDatabaseTransaction(client, () => callback(client));
    const accountId = await fixture(client);
    const repository = new PostgresProfessionalOnboardingRepository(tx);
    const [outcome, second] = await Promise.all([
      repository.create(accountId, { display_name: "Ana Profissional", phone_e164: "+5566999999911" }),
      repository.create(accountId, { display_name: "Ana Profissional", phone_e164: "+5566999999916" }),
    ]);
    assert.equal(outcome.kind, "created");
    if (outcome.kind !== "created") return;
    assert.equal(outcome.professional.status, "draft");
    assert.equal(outcome.professional.is_available_now, false);
    assert.equal(outcome.professional.is_verified, false);
    assert.deepEqual((await client.query("SELECT role,status FROM professional_memberships WHERE account_id=$1 AND professional_id=$2", [accountId, outcome.professional.id])).rows[0], { role: "owner", status: "active" });
    const events = (await client.query("SELECT action,new_role,new_status,actor_account_id,source FROM professional_membership_events WHERE account_id=$1 AND professional_id=$2", [accountId, outcome.professional.id])).rows;
    assert.deepEqual(events, [{ action: "created", new_role: "owner", new_status: "active", actor_account_id: accountId, source: "self_onboarding" }]);
    assert.equal(second.kind, "created");
    if (second.kind === "created") {
      assert.notEqual(second.professional.id, outcome.professional.id);
      assert.notEqual(second.professional.slug, outcome.professional.slug);
    }

    const internalProfile = randomUUID();
    await client.query("INSERT INTO professionals(id,display_name,slug,phone_e164) VALUES($1,'Internal profile',$2,'+5566999999912')", [internalProfile, `internal-${internalProfile}`]);
    await client.query("SELECT set_config('contatocerto.membership_actor_account_id','',true),set_config('contatocerto.membership_source','',true)");
    await client.query("INSERT INTO professional_memberships(account_id,professional_id,role) VALUES($1,$2,'member')", [accountId, internalProfile]);
    assert.deepEqual((await client.query("SELECT actor_account_id,source FROM professional_membership_events WHERE account_id=$1 AND professional_id=$2", [accountId, internalProfile])).rows[0], { actor_account_id: null, source: "internal_provisioning" });
  });
});

test("failure between profile and membership leaves no orphan professional", async () => {
  const accountId = randomUUID(), identifierId = randomUUID(), displayName = `Rollback Profile ${accountId}`;
  await query("INSERT INTO accounts(id) VALUES($1)", [accountId]);
  await query("INSERT INTO account_identifiers(id,account_id,kind,normalized_value,verified_at) VALUES($1,$2,'phone',$3,NOW())", [identifierId, accountId, `+5564${String(Date.now()).slice(-9)}`]);
  try {
    const marker = new Error("membership_insert_failed");
    const repository = new PostgresProfessionalOnboardingRepository(withTransaction, async () => { throw marker; });
    await assert.rejects(repository.create(accountId, { display_name: displayName, phone_e164: "+5566999999913" }), error => error === marker);
    assert.equal((await query("SELECT count(*)::int count FROM professionals WHERE display_name=$1", [displayName])).rows[0].count, 0);
  } finally {
    await query("DELETE FROM account_identifiers WHERE id=$1", [identifierId]);
    await query("DELETE FROM accounts WHERE id=$1", [accountId]);
  }
});

test("eligibility gates publish, availability and matching while preserving legacy matching SQL", async () => {
  await rolledBack(async client => {
    const tx = <T>(callback: (db: DatabaseClient) => Promise<T>) => inDatabaseTransaction(client, () => callback(client));
    const accountId = await fixture(client);
    const onboard = new PostgresProfessionalOnboardingRepository(tx);
    const created = await onboard.create(accountId, { display_name: "Lifecycle Profile", phone_e164: "+5566999999914" });
    assert.equal(created.kind, "created"); if (created.kind !== "created") return;
    const professionalId = created.professional.id;
    const eligibility = new PostgresProfessionalEligibilityRepository(tx);
    assert.equal((await eligibility.find(professionalId))?.ready_to_publish, false);
    await assert.rejects(eligibility.publish(accountId, professionalId), /professional_not_ready/u);

    const categoryId = randomUUID(), serviceId = randomUUID();
    await client.query("INSERT INTO service_categories(id,name,slug) VALUES($1,'Onboarding category',$2)", [categoryId, `category-${categoryId}`]);
    await client.query("INSERT INTO services(id,category_id,name,slug) VALUES($1,$2,'Onboarding service',$3)", [serviceId, categoryId, `service-${serviceId}`]);
    await client.query("INSERT INTO professional_services(professional_id,service_id) VALUES($1,$2)", [professionalId, serviceId]);
    await client.query("INSERT INTO professional_service_areas(professional_id,city,state,country_code,center,radius_meters,is_primary) VALUES($1,'Sinop','MT','BR',ST_SetSRID(ST_MakePoint(-55.5,-11.8),4326)::geography,50000,TRUE)", [professionalId]);
    const ready = await eligibility.find(professionalId); assert.equal(ready?.ready_to_publish, true); assert.equal(ready?.can_appear_in_matching, false);

    const search = () => new PostgresMatchingRepository(tx).search({ raw_text: "serviço", service_id: serviceId, latitude: -11.8, longitude: -55.5, city: "Sinop", state: "MT", limit: 10 });
    const before = await search(); assert.equal(before.kind, "success"); if (before.kind === "success") assert.equal(before.response.matches.some(item => item.professional.id === professionalId), false);
    const published = await eligibility.publish(accountId, professionalId); assert.equal(published.professional.status, "active"); assert.equal(published.professional.is_available_now, false);
    const during = await search(); assert.equal(during.kind, "success"); if (during.kind === "success") assert.equal(during.response.matches.some(item => item.professional.id === professionalId), true);
    assert.equal((await eligibility.updateAvailability(accountId, professionalId, true)).is_available_now, true);
    await client.query("UPDATE professional_services SET is_active=FALSE WHERE professional_id=$1", [professionalId]);
    const degradedService = await eligibility.find(professionalId); assert.equal(degradedService?.profile_status, "active"); assert.equal(degradedService?.ready_to_publish, false); assert.equal(degradedService?.can_receive_opportunities, false);
    await assert.rejects(eligibility.updateAvailability(accountId, professionalId, true), /professional_not_ready/u);
    assert.equal((await eligibility.updateAvailability(accountId, professionalId, false)).is_available_now, false);
    await client.query("UPDATE professional_services SET is_active=TRUE WHERE professional_id=$1", [professionalId]);
    await client.query("DELETE FROM professional_service_areas WHERE professional_id=$1", [professionalId]);
    assert.equal((await eligibility.find(professionalId))?.has_service_area, false);
    await client.query("INSERT INTO professional_service_areas(professional_id,city,state,country_code,center,radius_meters,is_primary) VALUES($1,'Sinop','MT','BR',ST_SetSRID(ST_MakePoint(-55.5,-11.8),4326)::geography,50000,TRUE)", [professionalId]);
    const unpublished = await eligibility.unpublish(accountId, professionalId); assert.equal(unpublished.professional.status, "draft"); assert.equal(unpublished.professional.is_available_now, false);
    const afterResult = await search(); assert.equal(afterResult.kind, "success"); if (afterResult.kind === "success") assert.equal(afterResult.response.matches.some(item => item.professional.id === professionalId), false);
    await client.query("UPDATE professionals SET status='suspended' WHERE id=$1", [professionalId]);
    await assert.rejects(eligibility.publish(accountId, professionalId), /professional_suspended/u);
  });
});

test("owner and admin can manage lifecycle while member, revoked membership and blocked account are denied", async () => {
  await rolledBack(async client => {
    const tx = <T>(callback: (db: DatabaseClient) => Promise<T>) => inDatabaseTransaction(client, () => callback(client));
    const ownerId = await fixture(client);
    const created = await new PostgresProfessionalOnboardingRepository(tx).create(ownerId, { display_name: "Role Profile", phone_e164: "+5566999999917" });
    assert.equal(created.kind, "created"); if (created.kind !== "created") return;
    const professionalId = created.professional.id, categoryId = randomUUID(), serviceId = randomUUID();
    await client.query("INSERT INTO service_categories(id,name,slug) VALUES($1,'Role category',$2)", [categoryId, `category-${categoryId}`]);
    await client.query("INSERT INTO services(id,category_id,name,slug) VALUES($1,$2,'Role service',$3)", [serviceId, categoryId, `service-${serviceId}`]);
    await client.query("INSERT INTO professional_services(professional_id,service_id) VALUES($1,$2)", [professionalId, serviceId]);
    await client.query("INSERT INTO professional_service_areas(professional_id,city,state,country_code,center,radius_meters) VALUES($1,'Sinop','MT','BR',ST_SetSRID(ST_MakePoint(-55.5,-11.8),4326)::geography,50000)", [professionalId]);
    const adminId = await fixture(client), memberId = await fixture(client);
    await client.query("INSERT INTO professional_memberships(account_id,professional_id,role) VALUES($1,$3,'admin'),($2,$3,'member')", [adminId, memberId, professionalId]);
    const eligibility = new PostgresProfessionalEligibilityRepository(tx);
    await assert.rejects(eligibility.publish(memberId, professionalId), /professional_forbidden/u);
    assert.equal((await eligibility.publish(adminId, professionalId)).professional.status, "active");
    assert.equal((await eligibility.unpublish(ownerId, professionalId)).professional.status, "draft");
    await client.query("UPDATE professional_memberships SET status='revoked' WHERE account_id=$1 AND professional_id=$2", [adminId, professionalId]);
    await assert.rejects(eligibility.publish(adminId, professionalId), /professional_forbidden/u);
    await client.query("UPDATE accounts SET status='blocked' WHERE id=$1", [ownerId]);
    await assert.rejects(eligibility.publish(ownerId, professionalId), /professional_forbidden/u);
  });
});

test("self-service PATCH cannot bypass eligibility before the official publish transition", async () => {
  await rolledBack(async client => {
    const tx = <T>(callback: (db: DatabaseClient) => Promise<T>) => inDatabaseTransaction(client, () => callback(client));
    const accountId = await fixture(client);
    const internalApiKey = "onboarding-boundary-test";
    const headers = { "x-internal-key": internalApiKey, authorization: "Bearer session" };
    const app = Fastify();
    const onboardingService = new ProfessionalOnboardingService(new PostgresProfessionalOnboardingRepository(tx));
    const eligibilityService = new ProfessionalEligibilityService(new PostgresProfessionalEligibilityRepository(tx));
    const service = {
      requestChallenge: async () => ({ accepted: true, challenge_reference: "unused", expires_in_seconds: 300 }),
      verify: async () => ({ ok: false as const }),
      authenticate: async (token: string | undefined) => token === "session"
        ? { sessionId: randomUUID(), accountId, expiresAt: new Date(Date.now() + 60_000) }
        : null,
      revoke: async () => true,
    };
    const accessService = { resolveProfessionalAccess: async (input: { accountId: string; professionalId: string }) => {
      const membership = await client.query<{ role: "owner" | "admin" | "member"; status: "active" | "revoked" }>(
        "SELECT role,status FROM professional_memberships WHERE account_id=$1 AND professional_id=$2", [input.accountId, input.professionalId],
      );
      return membership.rows[0]?.status === "active"
        ? { status: "authorized" as const, role: membership.rows[0].role }
        : { status: "not_member" as const };
    } };

    app.patch("/internal/professionals/:id", async request => {
      const id = (request.params as { id: string }).id;
      const body = request.body as { status?: string; display_name?: string; phone_e164?: string };
      if (body.status) await client.query("UPDATE professionals SET status=$2 WHERE id=$1", [id, body.status]);
      if (body.phone_e164) await client.query("UPDATE professionals SET phone_e164=$2 WHERE id=$1", [id, body.phone_e164]);
      if (body.display_name) await client.query("UPDATE professionals SET display_name=$2 WHERE id=$1", [id, body.display_name]);
      return { id, ...body };
    });
    await app.register(professionalAuthRoutes, { prefix: "/internal/professional-auth", internalApiKey,
      service, accessService, onboardingService, eligibilityService });

    try {
      const createdResponse = await app.inject({ method: "POST", url: "/internal/professional-auth/profiles", headers,
        payload: { display_name: "Boundary Profile", phone_e164: "+5566999999921" } });
      assert.equal(createdResponse.statusCode, 201, createdResponse.body);
      const professionalId = (createdResponse.json() as { id: string }).id;
      assert.deepEqual((await client.query("SELECT role,status FROM professional_memberships WHERE account_id=$1 AND professional_id=$2", [accountId, professionalId])).rows[0], { role: "owner", status: "active" });
      assert.equal((await eligibilityService.get(professionalId)).ready_to_publish, false);

      const bypass = await app.inject({ method: "PATCH", url: `/internal/professional-auth/profiles/${professionalId}`, headers, payload: { status: "active" } });
      assert.equal(bypass.statusCode, 400, bypass.body);
      assert.deepEqual(bypass.json(), { error: "invalid_request" });
      assert.equal((await client.query<{ status: string }>("SELECT status FROM professionals WHERE id=$1", [professionalId])).rows[0]?.status, "draft");

      const categoryId = randomUUID(), serviceId = randomUUID();
      await client.query("INSERT INTO service_categories(id,name,slug) VALUES($1,'Boundary category',$2)", [categoryId, `category-${categoryId}`]);
      await client.query("INSERT INTO services(id,category_id,name,slug) VALUES($1,$2,'Boundary service',$3)", [serviceId, categoryId, `service-${serviceId}`]);
      const matching = new PostgresMatchingRepository(tx);
      const before = await matching.search({ raw_text: "boundary", service_id: serviceId, latitude: -11.8, longitude: -55.5, city: "Sinop", state: "MT", limit: 10 });
      assert.equal(before.kind, "success");
      if (before.kind === "success") assert.equal(before.response.matches.some(item => item.professional.id === professionalId), false);

      await client.query("INSERT INTO professional_services(professional_id,service_id) VALUES($1,$2)", [professionalId, serviceId]);
      await client.query("INSERT INTO professional_service_areas(professional_id,city,state,country_code,center,radius_meters) VALUES($1,'Sinop','MT','BR',ST_SetSRID(ST_MakePoint(-55.5,-11.8),4326)::geography,50000)", [professionalId]);
      const published = await app.inject({ method: "POST", url: `/internal/professional-auth/profiles/${professionalId}/publish`, headers });
      assert.equal(published.statusCode, 200, published.body);
      assert.equal((await client.query<{ status: string }>("SELECT status FROM professionals WHERE id=$1", [professionalId])).rows[0]?.status, "active");
    } finally {
      await app.close();
    }
  });
});


