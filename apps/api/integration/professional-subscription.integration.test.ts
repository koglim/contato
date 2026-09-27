import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import {
  closeDatabaseConnection,
  inDatabaseTransaction,
  query,
  withTransaction,
} from "../src/database/connection.js";
import { PostgresMatchingRepository } from "../src/modules/matching/matching.repository.js";
import { PostgresSelectionMatchRepository } from "../src/modules/match-selection/match-selection.repository.js";
import { PostgresProfessionalSubscriptionRepository } from "../src/modules/professional-subscription/professional-subscription.repository.js";
import { ProfessionalOpportunityService } from "../src/modules/professional-opportunity/professional-opportunity.service.js";
import { createOpportunityCode } from "../src/modules/bilateral-contact/bilateral-contact.policy.js";
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
    await repo.grant(managed.professionalId, {
      plan_code: "marketplace_standard_v1",
      starts_at: new Date(Date.now() - 3600000).toISOString(),
      ends_at: new Date(Date.now() + 86400000 * 30).toISOString(),
    });
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
