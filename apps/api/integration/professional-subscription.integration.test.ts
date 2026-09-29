import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import {
  closeDatabaseConnection,
  inDatabaseTransaction,
  query,
  withIndependentTransaction,
  withTransaction,
} from "../src/database/connection.js";

async function waitForBarrierWithTimeout<T>(promise: Promise<T>, timeoutMs = 5000, description = "Barrier"): Promise<T> {
  let timeoutHandle: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(`${description} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutHandle));
}

async function waitForBlockedPid(client: DatabaseClient, blockedPid: number, blockerPid: number, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const blockersRes = await client.query<{ blockers: number[] }>(
      "SELECT pg_blocking_pids($1) AS blockers",
      [blockedPid],
    );
    if (blockersRes.rows[0]?.blockers?.includes(blockerPid)) {
      return;
    }
    await new Promise((r) => setImmediate(r));
  }
  throw new Error(`PID ${blockedPid} was not blocked by PID ${blockerPid} within ${timeoutMs}ms`);
}
import { PostgresMatchingRepository } from "../src/modules/matching/matching.repository.js";
import { PostgresSelectionMatchRepository } from "../src/modules/match-selection/match-selection.repository.js";
import type { SelectShownMatchOutcome } from "../src/modules/match-selection/match-selection.types.js";
import { PostgresProfessionalSubscriptionRepository } from "../src/modules/professional-subscription/professional-subscription.repository.js";
import { ProfessionalOpportunityService } from "../src/modules/professional-opportunity/professional-opportunity.service.js";
import {
  BILATERAL_NOTICE,
  BILATERAL_NOTICE_VERSION,
  createOpportunityCode,
} from "../src/modules/bilateral-contact/bilateral-contact.policy.js";
import { opportunityMessageSchema } from "@contatocerto/shared";
import { rollbackThrough } from "./rollback-helper.js";

/**
 * Narrows an unknown error to a PostgreSQL error by checking for
 * the `code` and `message` properties without using `any`.
 */
function isPgError(error: unknown, expectedCode: string, expectedMessage?: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (!("code" in error) || !("message" in error)) return false;
  const { code, message } = error as { code: unknown; message: unknown };
  if (code !== expectedCode) return false;
  if (expectedMessage !== undefined && typeof message === "string") {
    return message.includes(expectedMessage);
  }
  return true;
}

/**
 * Extracts a diagnostic string from an unknown error thrown by child_process
 * execFile (which surfaces stderr/stdout as properties alongside message).
 */
function extractRollbackError(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error);
  const e = error as Record<string, unknown>;
  if (typeof e["stderr"] === "string") return e["stderr"];
  if (typeof e["stdout"] === "string") return e["stdout"];
  if (typeof e["message"] === "string") return e["message"];
  return String(error);
}

after(closeDatabaseConnection);

async function rolledBack(operation: () => Promise<void>) {
  const marker = new Error("professional_subscription_test_rollback");
  try {
    await withTransaction((client) =>
      inDatabaseTransaction(client, async () => {
        await operation();
        throw marker;
      }),
    );
  } catch (error) {
    if (error !== marker) throw error;
  }
}

function randomPhone() {
  return `+556599${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 10)}`;
}

async function createBaseCatalogAndCustomer() {
  const categoryId = randomUUID();
  const serviceId = randomUUID();
  const customerId = randomUUID();
  const customerPhone = randomPhone();

  await query(
    `INSERT INTO service_categories (id, name, slug) VALUES ($1, 'Sub Test Cat', $2)`,
    [categoryId, `cat-${categoryId}`],
  );
  await query(
    `INSERT INTO services (id, category_id, name, slug) VALUES ($1, $2, 'Sub Test Svc', $3)`,
    [serviceId, categoryId, `svc-${serviceId}`],
  );
  await query(
    `INSERT INTO customers (id, phone_e164) VALUES ($1, $2)`,
    [customerId, customerPhone],
  );

  return { categoryId, serviceId, customerId, customerPhone };
}

async function createProfessional(params: {
  managementMode: "legacy_unmanaged" | "account_managed";
  serviceId: string;
  phoneE164?: string;
  status?: "draft" | "active" | "suspended";
}) {
  const professionalId = randomUUID();
  const phone = params.phoneE164 ?? randomPhone();
  const status = params.status ?? "active";

  await query(
    `INSERT INTO professionals (id, display_name, slug, phone_e164, status, management_mode)
     VALUES ($1, 'Prof Sub Test', $2, $3, $4, $5)`,
    [professionalId, `prof-${professionalId}`, phone, status, params.managementMode],
  );

  await query(
    `INSERT INTO professional_services (professional_id, service_id, is_active)
     VALUES ($1, $2, true)`,
    [professionalId, params.serviceId],
  );

  await query(
    `INSERT INTO professional_service_areas (professional_id, city, state, country_code, center, radius_meters)
     VALUES ($1, 'Cuiabá', 'MT', 'BR', ST_SetSRID(ST_MakePoint(-56.09, -15.60), 4326)::geography, 30000)`,
    [professionalId],
  );

  let accountId: string | undefined;
  let identifierId: string | undefined;

  if (params.managementMode === "account_managed") {
    accountId = randomUUID();
    identifierId = randomUUID();
    await query(`INSERT INTO accounts (id, status) VALUES ($1, 'active')`, [accountId]);
    await query(
      `INSERT INTO account_identifiers (id, account_id, kind, normalized_value, verified_at)
       VALUES ($1, $2, 'phone', $3, NOW())`,
      [identifierId, accountId, phone],
    );
    await query(
      `INSERT INTO professional_memberships (account_id, professional_id, role, status)
       VALUES ($1, $2, 'owner', 'active')`,
      [accountId, professionalId],
    );
  }

  return { professionalId, phone, accountId, identifierId };
}

async function cleanupProfessionalFixture(params: {
  professionalId: string;
  accountId?: string;
  serviceId?: string;
  categoryId?: string;
  customerId?: string;
}) {
  await query("ALTER TABLE professional_subscription_events DISABLE TRIGGER professional_subscription_events_immutable");
  await query(`DELETE FROM professional_subscription_events WHERE professional_id = $1`, [params.professionalId]);
  await query("ALTER TABLE professional_subscription_events ENABLE TRIGGER professional_subscription_events_immutable");

  await query(`DELETE FROM professional_subscriptions WHERE professional_id = $1`, [params.professionalId]);

  await query("ALTER TABLE professional_membership_events DISABLE TRIGGER professional_membership_event_immutable");
  await query(`DELETE FROM professional_membership_events WHERE professional_id = $1`, [params.professionalId]);
  await query("ALTER TABLE professional_membership_events ENABLE TRIGGER professional_membership_event_immutable");

  await query("ALTER TABLE professional_memberships DISABLE TRIGGER professional_membership_no_delete");
  await query(`DELETE FROM professional_memberships WHERE professional_id = $1`, [params.professionalId]);
  await query("ALTER TABLE professional_memberships ENABLE TRIGGER professional_membership_no_delete");

  if (params.accountId) {
    await query(`DELETE FROM account_identifiers WHERE account_id = $1`, [params.accountId]);
    await query(`DELETE FROM accounts WHERE id = $1`, [params.accountId]);
  }

  await query(`DELETE FROM professional_services WHERE professional_id = $1`, [params.professionalId]);
  await query(`DELETE FROM professional_service_areas WHERE professional_id = $1`, [params.professionalId]);
  await query(`DELETE FROM professionals WHERE id = $1`, [params.professionalId]);

  if (params.serviceId) {
    await query(`DELETE FROM services WHERE id = $1`, [params.serviceId]);
  }
  if (params.categoryId) {
    await query(`DELETE FROM service_categories WHERE id = $1`, [params.categoryId]);
  }
  if (params.customerId) {
    await query(`DELETE FROM customers WHERE id = $1`, [params.customerId]);
  }
}

test("entitlement snapshot accurately derives all 7 states and controlled reason codes", async () => {
  await rolledBack(async () => {
    const repo = new PostgresProfessionalSubscriptionRepository();
    const { serviceId } = await createBaseCatalogAndCustomer();

    // 1. legacy_exempt
    const legacy = await createProfessional({ managementMode: "legacy_unmanaged", serviceId });
    const legacySnapshot = await repo.getEntitlementSnapshot(legacy.professionalId);
    assert.equal(legacySnapshot.state, "legacy_exempt");
    assert.equal(legacySnapshot.has_marketplace_access, true);
    assert.equal(legacySnapshot.subscription_required, false);
    assert.deepEqual(legacySnapshot.reasons, []);
    assert.equal(legacySnapshot.plan_code, null);

    // 2. none (account_managed without subscription)
    const managed = await createProfessional({ managementMode: "account_managed", serviceId });
    const noneSnapshot = await repo.getEntitlementSnapshot(managed.professionalId);
    assert.equal(noneSnapshot.state, "none");
    assert.equal(noneSnapshot.has_marketplace_access, false);
    assert.equal(noneSnapshot.subscription_required, true);
    assert.deepEqual(noneSnapshot.reasons, ["subscription_required"]);

    // 3. not_started (starts_at in the future)
    await repo.grant(managed.professionalId, {
      plan_code: "marketplace_standard_v1",
      starts_at: new Date(Date.now() + 86400000).toISOString(),
      ends_at: new Date(Date.now() + 86400000 * 30).toISOString(),
    });
    const notStartedSnapshot = await repo.getEntitlementSnapshot(managed.professionalId);
    assert.equal(notStartedSnapshot.state, "not_started");
    assert.equal(notStartedSnapshot.has_marketplace_access, false);
    assert.deepEqual(notStartedSnapshot.reasons, ["subscription_not_started"]);

    // 4. active
    await query(
      `UPDATE professional_subscriptions
       SET starts_at = NOW() - INTERVAL '1 hour', ends_at = NOW() + INTERVAL '30 days'
       WHERE professional_id = $1`,
      [managed.professionalId],
    );
    const activeSnapshot = await repo.getEntitlementSnapshot(managed.professionalId);
    assert.equal(activeSnapshot.state, "active");
    assert.equal(activeSnapshot.has_marketplace_access, true);
    assert.deepEqual(activeSnapshot.reasons, []);

    // 5. expired (ends_at in the past)
    await query(
      `UPDATE professional_subscriptions
       SET starts_at = NOW() - INTERVAL '60 days', ends_at = NOW() - INTERVAL '1 day'
       WHERE professional_id = $1`,
      [managed.professionalId],
    );
    const expiredSnapshot = await repo.getEntitlementSnapshot(managed.professionalId);
    assert.equal(expiredSnapshot.state, "expired");
    assert.equal(expiredSnapshot.has_marketplace_access, false);
    assert.deepEqual(expiredSnapshot.reasons, ["subscription_expired"]);

    // 6. revoked
    await repo.revoke(managed.professionalId);
    const revokedSnapshot = await repo.getEntitlementSnapshot(managed.professionalId);
    assert.equal(revokedSnapshot.state, "revoked");
    assert.equal(revokedSnapshot.has_marketplace_access, false);
    assert.deepEqual(revokedSnapshot.reasons, ["subscription_revoked"]);

    // 7. plan_inactive
    const inactivePlanId = randomUUID();
    const inactivePlanCode = `inactive_${randomUUID().slice(0, 8)}`;
    await query(
      `INSERT INTO subscription_plans (id, code, name, is_active)
       VALUES ($1, $2, 'Inactive Plan', false)`,
      [inactivePlanId, inactivePlanCode],
    );
    await query(
      `INSERT INTO subscription_plan_entitlements (plan_id, entitlement_key)
       VALUES ($1, 'marketplace_access')`,
      [inactivePlanId],
    );
    await query(
      `UPDATE professional_subscriptions
       SET plan_id = $1, starts_at = NOW() - INTERVAL '1 day', ends_at = NOW() + INTERVAL '30 days', revoked_at = NULL
       WHERE professional_id = $2`,
      [inactivePlanId, managed.professionalId],
    );
    const inactiveSnapshot = await repo.getEntitlementSnapshot(managed.professionalId);
    assert.equal(inactiveSnapshot.state, "plan_inactive");
    assert.equal(inactiveSnapshot.has_marketplace_access, false);
    assert.deepEqual(inactiveSnapshot.reasons, ["subscription_plan_inactive"]);
  });
});

test("internal mutations create audit events, enforce locking and protect immutability", async () => {
  await rolledBack(async () => {
    const repo = new PostgresProfessionalSubscriptionRepository();
    const { serviceId } = await createBaseCatalogAndCustomer();
    const { professionalId } = await createProfessional({ managementMode: "account_managed", serviceId });

    // Grant
    const startsAt = new Date(Date.now() - 3600000).toISOString();
    const endsAt = new Date(Date.now() + 86400000 * 30).toISOString();
    const granted = await repo.grant(professionalId, {
      plan_code: "marketplace_standard_v1",
      starts_at: startsAt,
      ends_at: endsAt,
    });
    assert.equal(granted.state, "active");

    const eventsAfterGrant = await query<{ action: string; source: string }>(
      `SELECT action, source FROM professional_subscription_events WHERE professional_id = $1 ORDER BY created_at ASC`,
      [professionalId],
    );
    assert.equal(eventsAfterGrant.rows.length, 1);
    assert.equal(eventsAfterGrant.rows[0].action, "granted");
    assert.equal(eventsAfterGrant.rows[0].source, "internal_provisioning");

    // Extend
    const newEndsAt = new Date(Date.now() + 86400000 * 60).toISOString();
    const extended = await repo.extend(professionalId, { ends_at: newEndsAt });
    assert.equal(extended.state, "active");
    assert.equal(extended.ends_at, newEndsAt);

    // Invalid extend (ends_at <= current ends_at)
    await assert.rejects(
      () => repo.extend(professionalId, { ends_at: endsAt }),
      /invalid_extension_period/,
    );

    // Revoke
    const revoked = await repo.revoke(professionalId);
    assert.equal(revoked.state, "revoked");

    // Repeated revoke (idempotent - no extra event)
    const revokedAgain = await repo.revoke(professionalId);
    assert.equal(revokedAgain.state, "revoked");

    const eventsAfterRevoke = await query<{ action: string }>(
      `SELECT action FROM professional_subscription_events WHERE professional_id = $1 ORDER BY created_at ASC`,
      [professionalId],
    );
    // granted + extended + revoked = 3 events
    assert.equal(eventsAfterRevoke.rows.length, 3);
    assert.deepEqual(eventsAfterRevoke.rows.map((r) => r.action), ["granted", "extended", "revoked"]);

    // Reactivate
    const reactivated = await repo.reactivate(professionalId, {
      starts_at: new Date(Date.now() - 1000).toISOString(),
      ends_at: new Date(Date.now() + 86400000 * 90).toISOString(),
    });
    assert.equal(reactivated.state, "active");

    const eventsAfterReactivate = await query<{ action: string }>(
      `SELECT action FROM professional_subscription_events WHERE professional_id = $1 ORDER BY created_at ASC`,
      [professionalId],
    );
    assert.equal(eventsAfterReactivate.rows.length, 4);
    assert.equal(eventsAfterReactivate.rows[3].action, "reactivated");

    // Immutability trigger protection on professional_subscription_events (P0025)
    await query("SAVEPOINT sp1");
    await assert.rejects(
      () => query(`UPDATE professional_subscription_events SET action = 'tampered' WHERE professional_id = $1`, [professionalId]),
      (err: unknown) => isPgError(err, "P0025", "PROFESSIONAL_SUBSCRIPTION_EVENT_IMMUTABLE"),
    );
    await query("ROLLBACK TO sp1");

    await query("SAVEPOINT sp2");
    await assert.rejects(
      () => query(`DELETE FROM professional_subscription_events WHERE professional_id = $1`, [professionalId]),
      (err: unknown) => isPgError(err, "P0025", "PROFESSIONAL_SUBSCRIPTION_EVENT_IMMUTABLE"),
    );
    await query("ROLLBACK TO sp2");
  });
});

test("grant is create-only and rejects duplicate subscriptions on active and revoked states", async () => {
  await rolledBack(async () => {
    const repo = new PostgresProfessionalSubscriptionRepository();
    const { serviceId } = await createBaseCatalogAndCustomer();
    const { professionalId } = await createProfessional({ managementMode: "account_managed", serviceId });

    // Initial grant succeeds
    const startsAt = new Date(Date.now() - 3600000).toISOString();
    const endsAt = new Date(Date.now() + 86400000 * 30).toISOString();
    const granted = await repo.grant(professionalId, {
      plan_code: "marketplace_standard_v1",
      starts_at: startsAt,
      ends_at: endsAt,
    });
    assert.equal(granted.state, "active");

    // Re-granting when active throws subscription_already_exists
    await assert.rejects(
      () =>
        repo.grant(professionalId, {
          plan_code: "marketplace_standard_v1",
          starts_at: startsAt,
          ends_at: endsAt,
        }),
      /subscription_already_exists/,
    );

    // Revoke subscription
    await repo.revoke(professionalId);

    // Re-granting when revoked ALSO throws subscription_already_exists (must reactivate, not grant)
    await assert.rejects(
      () =>
        repo.grant(professionalId, {
          plan_code: "marketplace_standard_v1",
          starts_at: startsAt,
          ends_at: endsAt,
        }),
      /subscription_already_exists/,
    );
  });
});

test("concurrent grant calls on same professional: exactly one succeeds and one throws subscription_already_exists", async () => {
  const repo = new PostgresProfessionalSubscriptionRepository();
  const { serviceId, categoryId, customerId } = await createBaseCatalogAndCustomer();
  const { professionalId, accountId } = await createProfessional({ managementMode: "account_managed", serviceId });

  try {
    const startsAt = new Date(Date.now() - 3600000).toISOString();
    const endsAt = new Date(Date.now() + 86400000 * 30).toISOString();

    const [res1, res2] = await Promise.allSettled([
      repo.grant(professionalId, {
        plan_code: "marketplace_standard_v1",
        starts_at: startsAt,
        ends_at: endsAt,
      }),
      repo.grant(professionalId, {
        plan_code: "marketplace_standard_v1",
        starts_at: startsAt,
        ends_at: endsAt,
      }),
    ]);

    const successes = [res1, res2].filter((r) => r.status === "fulfilled");
    const failures = [res1, res2].filter((r) => r.status === "rejected");

    assert.equal(successes.length, 1, "Exactly one grant must succeed");
    assert.equal(failures.length, 1, "Exactly one grant must fail");
    assert.equal((failures[0] as PromiseRejectedResult).reason?.message, "subscription_already_exists");

    const subs = await query(`SELECT id FROM professional_subscriptions WHERE professional_id = $1`, [professionalId]);
    assert.equal(subs.rows.length, 1);

    const events = await query(`SELECT action FROM professional_subscription_events WHERE professional_id = $1`, [professionalId]);
    assert.equal(events.rows.length, 1);
    assert.equal(events.rows[0].action, "granted");
  } finally {
    await cleanupProfessionalFixture({ professionalId, accountId, serviceId, categoryId, customerId });
  }
});

test("matching search distinguishes legacy_unmanaged and account_managed with active/expired/revoked subscription", async () => {
  await rolledBack(async () => {
    const matchingRepo = new PostgresMatchingRepository();
    const subRepo = new PostgresProfessionalSubscriptionRepository();
    const { serviceId, customerId } = await createBaseCatalogAndCustomer();

    // 1. legacy_unmanaged without subscription matches
    const legacy = await createProfessional({ managementMode: "legacy_unmanaged", serviceId });

    // 2. account_managed without subscription is EXCLUDED
    const managed = await createProfessional({ managementMode: "account_managed", serviceId });

    const search1 = await matchingRepo.search(
      { service_id: serviceId, raw_text: "teste de matching", latitude: -15.60, longitude: -56.09, limit: 10 },
      { customerId },
    );
    assert.equal(search1.kind, "success");
    if (search1.kind === "success") {
      const matchProfIds = search1.response.matches.map((m) => m.professional.id);
      assert.ok(matchProfIds.includes(legacy.professionalId), "legacy_unmanaged should be included without subscription");
      assert.ok(!matchProfIds.includes(managed.professionalId), "account_managed without subscription must be excluded");

      // Verify fair-v1 score_breakdown has NO subscription fields
      const matchRow = await query<{ score_breakdown: Record<string, unknown> }>(
        `SELECT score_breakdown FROM matches WHERE search_request_id = $1`,
        [search1.response.search_request_id],
      );
      for (const row of matchRow.rows) {
        assert.equal("subscription" in row.score_breakdown, false);
        assert.equal("entitlement" in row.score_breakdown, false);
        assert.equal("plan" in row.score_breakdown, false);
      }
    }

    // 3. Grant active subscription to managed professional -> now appears
    await subRepo.grant(managed.professionalId, {
      plan_code: "marketplace_standard_v1",
      starts_at: new Date(Date.now() - 3600000).toISOString(),
      ends_at: new Date(Date.now() + 86400000 * 30).toISOString(),
    });

    const search2 = await matchingRepo.search(
      { service_id: serviceId, raw_text: "teste de matching 2", latitude: -15.60, longitude: -56.09, limit: 10 },
      { customerId },
    );
    assert.equal(search2.kind, "success");
    if (search2.kind === "success") {
      const matchProfIds = search2.response.matches.map((m) => m.professional.id);
      assert.ok(matchProfIds.includes(managed.professionalId), "account_managed with active subscription must be included");
    }

    // 4. Revoke subscription -> disappears
    await subRepo.revoke(managed.professionalId);
    const search3 = await matchingRepo.search(
      { service_id: serviceId, raw_text: "teste de matching 3", latitude: -15.60, longitude: -56.09, limit: 10 },
      { customerId },
    );
    assert.equal(search3.kind, "success");
    if (search3.kind === "success") {
      const matchProfIds = search3.response.matches.map((m) => m.professional.id);
      assert.ok(!matchProfIds.includes(managed.professionalId), "account_managed with revoked subscription must be excluded");
    }
  });
});

test("PR #13 carry-forward gap: persisted match revalidation enforces selective identity guard across pagination and selection", async () => {
  await rolledBack(async () => {
    const matchingRepo = new PostgresMatchingRepository();
    const selectionRepo = new PostgresSelectionMatchRepository();
    const subRepo = new PostgresProfessionalSubscriptionRepository();
    const { serviceId, customerId } = await createBaseCatalogAndCustomer();

    const managed = await createProfessional({ managementMode: "account_managed", serviceId });
    await subRepo.grant(managed.professionalId, {
      plan_code: "marketplace_standard_v1",
      starts_at: new Date(Date.now() - 3600000).toISOString(),
      ends_at: new Date(Date.now() + 86400000 * 30).toISOString(),
    });

    const search = await matchingRepo.search(
      { service_id: serviceId, raw_text: "teste gap identidade", latitude: -15.60, longitude: -56.09, limit: 5 },
      { customerId },
    );
    assert.equal(search.kind, "success");
    if (search.kind !== "success") return;

    const searchRequestId = search.response.search_request_id;
    // Mark the match as shown
    await query(`UPDATE matches SET shown_at = NOW() WHERE search_request_id = $1`, [searchRequestId]);

    const shownBefore = await selectionRepo.listShown(searchRequestId);
    assert.equal(shownBefore.length, 1);
    assert.equal(shownBefore[0].professionalId, managed.professionalId);

    // Revoke the professional's active membership (or block the account)
    await query(
      `UPDATE professional_memberships SET status = 'revoked' WHERE professional_id = $1`,
      [managed.professionalId],
    );

    // Revalidation proves resumedMatchEligibilitySql immediately excludes the match!
    const shownAfter = await selectionRepo.listShown(searchRequestId);
    assert.equal(shownAfter.length, 0, "listShown must exclude match when membership is revoked");

    const byPos = await selectionRepo.findShownByPosition(searchRequestId, 1);
    assert.equal(byPos, null, "findShownByPosition must exclude match when membership is revoked");

    // Conversation setup for selectShownMatch
    const conversationId = randomUUID();
    await query(
      `INSERT INTO search_conversations (id, customer_id, search_request_id, status, pending_slot, original_raw_text, service_text, country_code, limit_value, expires_at)
       VALUES ($1, $2, $3, 'active', 'selection', 'preciso de servico', 'servico', 'BR', 3, NOW() + INTERVAL '1 hour')`,
      [conversationId, customerId, searchRequestId],
    );

    const selectionOutcome = await selectionRepo.selectShownMatch({
      customerId,
      conversationId,
      searchRequestId,
      position: 1,
      selectionKey: randomUUID(),
      inboundMessageId: randomUUID(),
      now: new Date(),
    });

    assert.equal(selectionOutcome.kind, "match_not_available");

    // Verify zero contacts created
    const contactsCount = await query<{ count: number }>(
      `SELECT count(*)::int count FROM contacts WHERE search_request_id = $1`,
      [searchRequestId],
    );
    assert.equal(contactsCount.rows[0].count, 0);
  });
});

test("persisted match revalidation: subscription revocation/expiration rejects selection as match_not_available", async () => {
  await rolledBack(async () => {
    const matchingRepo = new PostgresMatchingRepository();
    const selectionRepo = new PostgresSelectionMatchRepository();
    const subRepo = new PostgresProfessionalSubscriptionRepository();
    const { serviceId, customerId } = await createBaseCatalogAndCustomer();

    const managed = await createProfessional({ managementMode: "account_managed", serviceId });
    await subRepo.grant(managed.professionalId, {
      plan_code: "marketplace_standard_v1",
      starts_at: new Date(Date.now() - 3600000).toISOString(),
      ends_at: new Date(Date.now() + 86400000 * 30).toISOString(),
    });

    const search = await matchingRepo.search(
      { service_id: serviceId, raw_text: "teste expiracao pos match", latitude: -15.60, longitude: -56.09, limit: 5 },
      { customerId },
    );
    assert.equal(search.kind, "success");
    if (search.kind !== "success") return;

    const searchRequestId = search.response.search_request_id;
    await query(`UPDATE matches SET shown_at = NOW() WHERE search_request_id = $1`, [searchRequestId]);

    // Conversation setup
    const conversationId = randomUUID();
    await query(
      `INSERT INTO search_conversations (id, customer_id, search_request_id, status, pending_slot, original_raw_text, service_text, country_code, limit_value, expires_at)
       VALUES ($1, $2, $3, 'active', 'selection', 'preciso de servico', 'servico', 'BR', 3, NOW() + INTERVAL '1 hour')`,
      [conversationId, customerId, searchRequestId],
    );

    // Revoke subscription after match was shown
    await subRepo.revoke(managed.professionalId);

    const selectionOutcome = await selectionRepo.selectShownMatch({
      customerId,
      conversationId,
      searchRequestId,
      position: 1,
      selectionKey: randomUUID(),
      inboundMessageId: randomUUID(),
      now: new Date(),
    });

    assert.equal(selectionOutcome.kind, "match_not_available");

    // Zero contacts, zero outbound messages
    const contacts = await query(`SELECT id FROM contacts WHERE search_request_id = $1`, [searchRequestId]);
    assert.equal(contacts.rows.length, 0);
    const outbox = await query(
      `SELECT id FROM channel_outbound_messages WHERE purpose = 'professional_contact_notification'`,
    );
    assert.equal(outbox.rows.length, 0);
  });
});

test("pagination revalidation: unshown match with expired subscription is skipped in listNextUnshown", async () => {
  await rolledBack(async () => {
    const matchingRepo = new PostgresMatchingRepository();
    const selectionRepo = new PostgresSelectionMatchRepository();
    const subRepo = new PostgresProfessionalSubscriptionRepository();
    const { serviceId, customerId } = await createBaseCatalogAndCustomer();

    const managed = await createProfessional({ managementMode: "account_managed", serviceId });
    await subRepo.grant(managed.professionalId, {
      plan_code: "marketplace_standard_v1",
      starts_at: new Date(Date.now() - 3600000).toISOString(),
      ends_at: new Date(Date.now() + 86400000 * 30).toISOString(),
    });

    const search = await matchingRepo.search(
      { service_id: serviceId, raw_text: "teste pagination", latitude: -15.60, longitude: -56.09, limit: 1 },
      { customerId },
    );
    assert.equal(search.kind, "success");
    if (search.kind !== "success") return;

    const searchRequestId = search.response.search_request_id;
    // Keep shown_at = NULL (unshown)

    // Expire subscription (ends_at must be > starts_at)
    await query(
      `UPDATE professional_subscriptions SET starts_at = NOW() - INTERVAL '2 days', ends_at = NOW() - INTERVAL '1 day' WHERE professional_id = $1`,
      [managed.professionalId],
    );

    const unshown = await selectionRepo.listNextUnshown(searchRequestId, 5);
    assert.equal(unshown.length, 0, "listNextUnshown must skip professional whose subscription expired");
  });
});

test("delivered contact invariant: contacts already delivered remain respondable after subscription revocation", async () => {
  await rolledBack(async () => {
    const subRepo = new PostgresProfessionalSubscriptionRepository();
    const oppService = new ProfessionalOpportunityService();
    const { serviceId, customerId, customerPhone } = await createBaseCatalogAndCustomer();

    const managed = await createProfessional({ managementMode: "account_managed", serviceId });
    await subRepo.grant(managed.professionalId, {
      plan_code: "marketplace_standard_v1",
      starts_at: new Date(Date.now() - 3600000).toISOString(),
      ends_at: new Date(Date.now() + 86400000 * 30).toISOString(),
    });

    const searchId = randomUUID();
    await query(
      `INSERT INTO search_requests (id, customer_id, raw_text, status) VALUES ($1, $2, 'teste delivered contact', 'selected')`,
      [searchId, customerId],
    );

    const conversationId = randomUUID();
    await query(
      `INSERT INTO search_conversations (id, customer_id, search_request_id, status, original_raw_text, service_text, country_code, limit_value, expires_at, completed_at)
       VALUES ($1, $2, $3, 'completed', 'teste delivered contact', 'servico', 'BR', 3, NOW() + INTERVAL '1 hour', NOW())`,
      [conversationId, customerId, searchId],
    );

    const contactId = randomUUID();
    const code = createOpportunityCode();
    const choiceId = randomUUID();
    await query(
      `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text, status)
       VALUES ($1, 'test', $2, $3, '1', 'received')`,
      [choiceId, `choice-${choiceId}`, customerPhone],
    );
    const snapshot = {
      public_code: code,
      service_name: "Sub Test Svc",
      city: "Cuiabá",
      state: "MT",
      neighborhood: null,
      summary: "Sub Test Svc",
      professional_name: "Prof Sub Test",
      professional_phone_e164: managed.phone,
      customer_phone_e164: customerPhone,
      notice_version: "bilateral-v1",
      notice_outbound_id: randomUUID(),
      notice_sent_at: new Date().toISOString(),
      choice_inbound_id: choiceId,
      chosen_at: new Date().toISOString(),
      consented_at: new Date().toISOString(),
      consent_method: "selection_after_notice",
    };
    await query(
      `INSERT INTO contacts (id, professional_id, customer_id, search_request_id, selection_key, public_code, bilateral_snapshot, status, selection_conversation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'requested', $8)`,
      [contactId, managed.professionalId, customerId, searchId, choiceId, code, JSON.stringify(snapshot), conversationId],
    );

    // NOW revoke the professional's subscription!
    await subRepo.revoke(managed.professionalId);

    // The professional sends "aceito <codigo>" via WhatsApp inbound message
    const inboundId = randomUUID();
    const token = randomUUID();
    await query(
      `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text, status, processing_token, processing_started_at, lease_expires_at)
       VALUES ($1, 'test', $2, $3, $4, 'processing', $5, NOW(), NOW() + INTERVAL '1 minute')`,
      [inboundId, `msg-${inboundId}`, managed.phone, `aceito ${code}`, token],
    );

    const oppOutcome = await oppService.handle({
      id: inboundId,
      provider: "test",
      phoneE164: managed.phone,
      rawText: `aceito ${code}`,
      receivedAt: new Date(),
      processingToken: token,
    });

    assert.ok(oppOutcome);
    const parsed = opportunityMessageSchema.safeParse(oppOutcome.result);
    assert.ok(parsed.success, "oppOutcome.result should match opportunityMessageSchema");
    assert.equal(parsed.data.result.kind, "accepted");

    // Contact status is updated to 'accepted'
    const updatedContact = (await query<{ status: string }>(`SELECT status FROM contacts WHERE id = $1`, [contactId])).rows[0];
    assert.equal(updatedContact.status, "accepted");
  });
});

test("concurrency Scenario A: REVOKE VENCE - selection blocks on professional row lock, revoke commits first, selection sees match_not_available and creates 0 contacts", async () => {
  const { serviceId, categoryId, customerId, customerPhone } = await createBaseCatalogAndCustomer();
  const { professionalId, phone: profPhone, accountId } = await createProfessional({ managementMode: "account_managed", serviceId });
  const subRepo = new PostgresProfessionalSubscriptionRepository();

  await subRepo.grant(professionalId, {
    plan_code: "marketplace_standard_v1",
    starts_at: new Date(Date.now() - 3600000).toISOString(),
    ends_at: new Date(Date.now() + 86400000 * 30).toISOString(),
  });

  const searchRequestId = randomUUID();
  await query(
    `INSERT INTO search_requests (id, customer_id, raw_text, service_id, status, location)
     VALUES ($1, $2, 'teste concorrencia A', $3, 'matched', ST_SetSRID(ST_MakePoint(-56.09, -15.60), 4326)::geography)`,
    [searchRequestId, customerId, serviceId],
  );

  const conversationId = randomUUID();
  await query(
    `INSERT INTO search_conversations (id, customer_id, search_request_id, status, pending_slot, original_raw_text, service_text, country_code, limit_value, expires_at)
     VALUES ($1, $2, $3, 'active', 'selection', 'teste concorrencia A', 'servico', 'BR', 3, NOW() + INTERVAL '1 hour')`,
    [conversationId, customerId, searchRequestId],
  );

  const matchId = randomUUID();
  await query(
    `INSERT INTO matches (id, search_request_id, professional_id, rank_position, score, score_breakdown, shown_at)
     VALUES ($1, $2, $3, 1, 100, '{}'::jsonb, NOW())`,
    [matchId, searchRequestId, professionalId],
  );

  const selectionInboundId = randomUUID();
  await query(
    `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text, status)
     VALUES ($1, 'test', $2, $3, '1', 'received')`,
    [selectionInboundId, `sel-${selectionInboundId}`, customerPhone],
  );

  try {
    let clientBPid: number | undefined;
    let reachedLockResolve: () => void;
    const reachedLockPromise = new Promise<void>((r) => { reachedLockResolve = r; });

    // Custom selection repo running on connection B with query interceptor
    const trackingSelectionRepo = new PostgresSelectionMatchRepository(
      undefined,
      async (callback) => {
        return withIndependentTransaction(async (realClientB) => {
          clientBPid = (await realClientB.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
          const proxyClientB: DatabaseClient = {
            query: async (text: string, values?: SqlValue[]) => {
              if (typeof text === "string" && text.includes("FROM professionals") && text.includes("FOR UPDATE")) {
                reachedLockResolve();
              }
              return realClientB.query(text, values);
            },
          };
          return callback(proxyClientB);
        });
      },
    );

    let selectionPromise: Promise<SelectShownMatchOutcome> | undefined;

    // Transaction A locks the professional row first
    await withTransaction(async (clientA) => {
      const clientAPid = (await clientA.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await clientA.query(`SELECT id FROM professionals WHERE id = $1 FOR UPDATE`, [professionalId]);

      // Start selection concurrently on connection B
      selectionPromise = trackingSelectionRepo.selectShownMatch({
        customerId,
        conversationId,
        searchRequestId,
        position: 1,
        selectionKey: selectionInboundId,
        inboundMessageId: selectionInboundId,
        lastMessageText: "1",
        now: new Date(),
      });

      // Deterministic barrier: wait until selection reaches the professional row lock
      await waitForBarrierWithTimeout(reachedLockPromise, 5000, "Selection reaching professional FOR UPDATE lock");

      assert.ok(clientBPid, "clientB PID must be initialized");
      assert.notEqual(clientAPid, clientBPid, "clientA and clientB must have distinct PostgreSQL backend PIDs");

      // Confirm via PostgreSQL that connection B is actively blocked waiting on clientAPid
      await waitForBlockedPid(clientA, clientBPid, clientAPid, 5000);

      // While holding lock, revoke the subscription using clientA
      await subRepo.revoke(professionalId, clientA);
      // Exiting withTransaction commits clientA's transaction and releases the lock on professionalId
    });

    // Wait for selection to unblock and finish
    assert.ok(selectionPromise);
    const outcome = await selectionPromise;
    assert.equal(outcome.kind, "match_not_available");

    // Invariant 1: 0 contacts created for search_request
    const contactsCount = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM contacts WHERE search_request_id = $1`,
      [searchRequestId],
    );
    assert.equal(contactsCount.rows[0].count, 0, "No contacts should be created when revoke wins");

    // Invariant 2: match.selected_at IS NULL
    const matchRow = (await query<{ selected_at: Date | null }>(
      `SELECT selected_at FROM matches WHERE id = $1`,
      [matchId],
    )).rows[0];
    assert.equal(matchRow.selected_at, null, "Match must not be marked selected");

    // Invariant 3: zero professional_contact_notification outbound messages for professional
    const profNotificationCount = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM channel_outbound_messages
       WHERE purpose = 'professional_contact_notification' AND recipient_phone_e164 = $1`,
      [profPhone],
    );
    assert.equal(profNotificationCount.rows[0].count, 0, "No professional contact notification should be sent");

    // Invariant 4: zero outbound messages for customer or professional
    const allOutboxCount = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM channel_outbound_messages WHERE recipient_phone_e164 IN ($1, $2)`,
      [customerPhone, profPhone],
    );
    assert.equal(allOutboxCount.rows[0].count, 0, "No outbound messages should be created");

    // Invariant 5: zero initial contact business keys
    const contactInitialKeyCount = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM channel_outbound_messages WHERE business_key LIKE 'contact:%:initial'`,
    );
    assert.equal(contactInitialKeyCount.rows[0].count, 0, "No initial contact messages should be created");
  } finally {
    await query(`DELETE FROM channel_outbound_messages WHERE recipient_phone_e164 IN ($1, $2)`, [customerPhone, profPhone]);
    await query(`DELETE FROM contacts WHERE search_request_id = $1`, [searchRequestId]);
    await query(`DELETE FROM channel_inbound_messages WHERE id = $1`, [selectionInboundId]);
    await query(`DELETE FROM matches WHERE search_request_id = $1`, [searchRequestId]);
    await query(`DELETE FROM search_conversations WHERE id = $1`, [conversationId]);
    await query(`DELETE FROM search_requests WHERE id = $1`, [searchRequestId]);
    await cleanupProfessionalFixture({ professionalId, accountId, serviceId, categoryId, customerId });
  }
});

test("concurrency Scenario B: SELECTION VENCE - selection locks professional first, concurrent revoke blocks, selection completes contact, revoke finishes; contact remains valid and opportunity respondable", async () => {
  const { serviceId, categoryId, customerId, customerPhone } = await createBaseCatalogAndCustomer();
  const { professionalId, phone: profPhone, accountId } = await createProfessional({ managementMode: "account_managed", serviceId });
  const subRepo = new PostgresProfessionalSubscriptionRepository();
  const oppService = new ProfessionalOpportunityService();

  await subRepo.grant(professionalId, {
    plan_code: "marketplace_standard_v1",
    starts_at: new Date(Date.now() - 3600000).toISOString(),
    ends_at: new Date(Date.now() + 86400000 * 30).toISOString(),
  });

  const searchRequestId = randomUUID();
  await query(
    `INSERT INTO search_requests (id, customer_id, raw_text, service_id, status, location)
     VALUES ($1, $2, 'teste concorrencia B', $3, 'matched', ST_SetSRID(ST_MakePoint(-56.09, -15.60), 4326)::geography)`,
    [searchRequestId, customerId, serviceId],
  );

  const conversationId = randomUUID();
  await query(
    `INSERT INTO search_conversations (id, customer_id, search_request_id, status, pending_slot, original_raw_text, service_text, country_code, limit_value, expires_at)
     VALUES ($1, $2, $3, 'active', 'selection', 'teste concorrencia B', 'servico', 'BR', 3, NOW() + INTERVAL '1 hour')`,
    [conversationId, customerId, searchRequestId],
  );

  const matchId = randomUUID();
  await query(
    `INSERT INTO matches (id, search_request_id, professional_id, rank_position, score, score_breakdown, shown_at)
     VALUES ($1, $2, $3, 1, 100, '{}'::jsonb, NOW())`,
    [matchId, searchRequestId, professionalId],
  );

  // Presentation inbound and outbound message with BILATERAL_NOTICE
  const presentationInboundId = randomUUID();
  await query(
    `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text, status, customer_id, conversation_id, search_request_id, result, processed_at)
     VALUES ($1, 'test', $2, $3, 'teste concorrencia B', 'processed', $4, $5, $6, '{"route":"contextual"}'::jsonb, NOW())`,
    [presentationInboundId, `pres-${presentationInboundId}`, customerPhone, customerId, conversationId, searchRequestId],
  );

  const presentationOutboundId = randomUUID();
  await query(
    `INSERT INTO channel_outbound_messages (id, channel_inbound_message_id, provider, recipient_phone_e164, text_content, status, sent_at, bilateral_notice_version, provider_message_id)
     VALUES ($1, $2, 'test', $3, $4, 'sent', NOW(), $5, $6)`,
    [presentationOutboundId, presentationInboundId, customerPhone, `1. Prof Sub Test\n${BILATERAL_NOTICE}`, BILATERAL_NOTICE_VERSION, `prov-${presentationOutboundId}`],
  );

  await query(
    `INSERT INTO channel_outbound_message_matches (channel_outbound_message_id, match_id) VALUES ($1, $2)`,
    [presentationOutboundId, matchId],
  );

  const selectionInboundId = randomUUID();
  await query(
    `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text, status)
     VALUES ($1, 'test', $2, $3, '1', 'received')`,
    [selectionInboundId, `sel-${selectionInboundId}`, customerPhone],
  );

  try {
    let clientBPid: number | undefined;
    let revokeReachedLockResolve: () => void;
    const revokeReachedLockPromise = new Promise<void>((r) => { revokeReachedLockResolve = r; });

    let revokePromise: Promise<unknown> | undefined;

    // Selection repo with barrier hook: triggers revoke after acquiring professional lock
    const selectionRepo = new PostgresSelectionMatchRepository(
      undefined,
      undefined,
      undefined,
      async (clientA, profId) => {
        const clientAPid = (await clientA.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;

        // Dispatched in background on an independent connection B with query interceptor
        const subRepoB = new PostgresProfessionalSubscriptionRepository(
          async (callback) => {
            return withIndependentTransaction(async (realClientB) => {
              clientBPid = (await realClientB.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
              const proxyClientB: DatabaseClient = {
                query: async (text: string, values?: SqlValue[]) => {
                  if (typeof text === "string" && text.includes("FROM professionals") && text.includes("FOR UPDATE")) {
                    revokeReachedLockResolve();
                  }
                  return realClientB.query(text, values);
                },
              };
              return callback(proxyClientB);
            });
          },
        );
        revokePromise = subRepoB.revoke(profId);

        // Deterministic barrier: wait until revoke reaches the lock on professionals
        await waitForBarrierWithTimeout(revokeReachedLockPromise, 5000, "Revoke reaching professional FOR UPDATE lock");

        assert.ok(clientBPid, "clientB PID must be initialized");
        assert.notEqual(clientAPid, clientBPid, "clientA and clientB must have distinct PostgreSQL backend PIDs");

        // Confirm via PostgreSQL that connection B is blocked by connection A
        await waitForBlockedPid(clientA, clientBPid, clientAPid, 5000);
      },
    );

    const selectionOutcome = await selectionRepo.selectShownMatch({
      customerId,
      conversationId,
      searchRequestId,
      position: 1,
      selectionKey: selectionInboundId,
      inboundMessageId: selectionInboundId,
      lastMessageText: "1",
      now: new Date(),
    });

    assert.equal(selectionOutcome.kind, "selected");
    if (selectionOutcome.kind !== "selected") return;

    // Invariant: contact was successfully created and committed before revocation finishes
    const contactRow = (await query<{ id: string; status: string; public_code: string }>(
      `SELECT id, status, public_code FROM contacts WHERE id = $1`,
      [selectionOutcome.contactId],
    )).rows[0];
    assert.ok(contactRow);
    assert.equal(contactRow.status, "shared");

    // Wait for the background revoke to unblock and finish
    assert.ok(revokePromise);
    await revokePromise;

    // Subscription is now revoked
    const snapshot = await subRepo.getEntitlementSnapshot(professionalId);
    assert.equal(snapshot.state, "revoked");

    // Invariant: Delivered contact remains respondable despite later revocation
    const oppInboundId = randomUUID();
    const oppToken = randomUUID();
    await query(
      `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text, status, processing_token, processing_started_at, lease_expires_at)
       VALUES ($1, 'test', $2, $3, $4, 'processing', $5, NOW(), NOW() + INTERVAL '1 minute')`,
      [oppInboundId, `opp-${oppInboundId}`, profPhone, `aceito ${contactRow.public_code}`, oppToken],
    );

    const oppOutcome = await oppService.handle({
      id: oppInboundId,
      provider: "test",
      phoneE164: profPhone,
      rawText: `aceito ${contactRow.public_code}`,
      receivedAt: new Date(),
      processingToken: oppToken,
    });

    assert.ok(oppOutcome);
    const parsed = opportunityMessageSchema.safeParse(oppOutcome.result);
    assert.ok(parsed.success);
    assert.equal(parsed.data.result.kind, "acknowledged");

    const updatedContact = (await query<{ status: string }>(`SELECT status FROM contacts WHERE id = $1`, [contactRow.id])).rows[0];
    assert.equal(updatedContact.status, "shared");
  } finally {
    await query(`UPDATE channel_inbound_messages SET response_outbound_id = NULL WHERE phone_e164 IN ($1, $2)`, [customerPhone, profPhone]);
    await query(`DELETE FROM channel_outbound_message_matches WHERE match_id = $1`, [matchId]);
    await query(`DELETE FROM channel_outbound_messages WHERE recipient_phone_e164 IN ($1, $2)`, [customerPhone, profPhone]);
    await query("ALTER TABLE opportunity_response_events DISABLE TRIGGER opportunity_event_immutable");
    await query(`DELETE FROM opportunity_response_events WHERE contact_id IN (SELECT id FROM contacts WHERE search_request_id = $1)`, [searchRequestId]);
    await query("ALTER TABLE opportunity_response_events ENABLE TRIGGER opportunity_event_immutable");
    await query(`DELETE FROM channel_inbound_messages WHERE phone_e164 IN ($1, $2)`, [customerPhone, profPhone]);
    await query(`DELETE FROM contacts WHERE search_request_id = $1`, [searchRequestId]);
    await query(`DELETE FROM matches WHERE search_request_id = $1`, [searchRequestId]);
    await query(`DELETE FROM search_conversations WHERE id = $1`, [conversationId]);
    await query(`DELETE FROM search_requests WHERE id = $1`, [searchRequestId]);
    await cleanupProfessionalFixture({ professionalId, accountId, serviceId, categoryId, customerId });
  }
});

test("semantic reactivate lifecycle: rejects active, accepts expired, accepts revoked, and validates plan activity", async () => {
  await rolledBack(async () => {
    const repo = new PostgresProfessionalSubscriptionRepository();
    const { serviceId } = await createBaseCatalogAndCustomer();
    const { professionalId } = await createProfessional({ managementMode: "account_managed", serviceId });

    // 1. Grant an active subscription
    await repo.grant(professionalId, {
      plan_code: "marketplace_standard_v1",
      starts_at: new Date(Date.now() - 3600000).toISOString(),
      ends_at: new Date(Date.now() + 86400000 * 30).toISOString(),
    });

    // 2. Active subscription + reactivate -> 409 subscription_not_reactivatable
    await assert.rejects(
      () => repo.reactivate(professionalId, {
        starts_at: new Date(Date.now() - 1000).toISOString(),
        ends_at: new Date(Date.now() + 86400000 * 60).toISOString(),
      }),
      /subscription_not_reactivatable/,
    );

    // Verify no 'reactivated' event was written
    const eventsAfterActiveReactivate = await query<{ action: string }>(
      `SELECT action FROM professional_subscription_events WHERE professional_id = $1 AND action = 'reactivated'`,
      [professionalId],
    );
    assert.equal(eventsAfterActiveReactivate.rows.length, 0);

    // 3. Expired subscription + reactivate -> works!
    await query(
      `UPDATE professional_subscriptions
       SET starts_at = NOW() - INTERVAL '60 days', ends_at = NOW() - INTERVAL '1 day'
       WHERE professional_id = $1`,
      [professionalId],
    );
    const expiredReactivated = await repo.reactivate(professionalId, {
      starts_at: new Date(Date.now() - 1000).toISOString(),
      ends_at: new Date(Date.now() + 86400000 * 30).toISOString(),
    });
    assert.equal(expiredReactivated.state, "active");
    const eventsAfterExpiredReactivate = await query<{ action: string }>(
      `SELECT action FROM professional_subscription_events WHERE professional_id = $1 AND action = 'reactivated'`,
      [professionalId],
    );
    assert.equal(eventsAfterExpiredReactivate.rows.length, 1);

    // 4. Revoked subscription + reactivate -> works!
    await repo.revoke(professionalId);
    const revokedReactivated = await repo.reactivate(professionalId, {
      starts_at: new Date(Date.now() - 1000).toISOString(),
      ends_at: new Date(Date.now() + 86400000 * 30).toISOString(),
    });
    assert.equal(revokedReactivated.state, "active");
    const eventsAfterRevokedReactivate = await query<{ action: string }>(
      `SELECT action FROM professional_subscription_events WHERE professional_id = $1 AND action = 'reactivated'`,
      [professionalId],
    );
    assert.equal(eventsAfterRevokedReactivate.rows.length, 2);

    // 5. Inactive current plan without replacement -> 409 plan_inactive
    await repo.revoke(professionalId);
    const currentPlanId = (await query<{ plan_id: string }>(
      `SELECT plan_id FROM professional_subscriptions WHERE professional_id = $1`,
      [professionalId],
    )).rows[0].plan_id;

    // Temporarily mark plan as inactive
    await query(`UPDATE subscription_plans SET is_active = FALSE WHERE id = $1`, [currentPlanId]);
    try {
      await assert.rejects(
        () => repo.reactivate(professionalId, {
          starts_at: new Date(Date.now() - 1000).toISOString(),
          ends_at: new Date(Date.now() + 86400000 * 30).toISOString(),
        }),
        /plan_inactive/,
      );
    } finally {
      // Restore plan active status
      await query(`UPDATE subscription_plans SET is_active = TRUE WHERE id = $1`, [currentPlanId]);
    }
  });
});

test("migration 025 rollback is blocked with P0025 when subscriptions or events exist", async () => {
  const { serviceId, categoryId, customerId } = await createBaseCatalogAndCustomer();
  const { professionalId } = await createProfessional({ managementMode: "legacy_unmanaged", serviceId });

  const planId = (await query<{ id: string }>(`SELECT id FROM subscription_plans WHERE code = 'marketplace_standard_v1'`)).rows[0].id;
  const subId = randomUUID();
  try {
    await query(
      `INSERT INTO professional_subscriptions (id, professional_id, plan_id, starts_at, ends_at)
       VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '30 days')`,
      [subId, professionalId, planId],
    );

    // Attempting rollback through 025 must be blocked with P0025
    await assert.rejects(
      () => rollbackThrough("025_add_professional_subscriptions"),
      (err: unknown) =>
        /PROFESSIONAL_SUBSCRIPTION_ROLLBACK_BLOCKED|P0025/u.test(extractRollbackError(err)),
    );
  } finally {
    await query(`DELETE FROM professional_subscriptions WHERE id = $1`, [subId]);
    await query(`DELETE FROM professional_services WHERE professional_id = $1`, [professionalId]);
    await query(`DELETE FROM professional_service_areas WHERE professional_id = $1`, [professionalId]);
    await query(`DELETE FROM professionals WHERE id = $1`, [professionalId]);
    await query(`DELETE FROM services WHERE id = $1`, [serviceId]);
    await query(`DELETE FROM service_categories WHERE id = $1`, [categoryId]);
    await query(`DELETE FROM customers WHERE id = $1`, [customerId]);
  }
});
