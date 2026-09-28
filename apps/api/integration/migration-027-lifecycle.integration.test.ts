import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { closeDatabaseConnection, query, withTransaction } from "../src/database/connection.js";
import { createOpportunityCode } from "../src/modules/bilateral-contact/bilateral-contact.policy.js";
import { rollbackThrough } from "./rollback-helper.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

after(closeDatabaseConnection);

const phone = () => `+5566${Math.floor(100000000 + Math.random() * 899999999)}`;

async function migrateUp(count?: number) {
  const args = [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js",
    "up",
    ...(count ? [String(count)] : []),
    "-m",
    "database/migrations",
    "--database-url-var",
    "DATABASE_URL",
  ];
  return promisify(execFile)(process.execPath, args, {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
  });
}

async function migrateDown(count = 1) {
  const args = [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js",
    "down",
    String(count),
    "--single-transaction",
    "-m",
    "database/migrations",
    "--database-url-var",
    "DATABASE_URL",
  ];
  return promisify(execFile)(process.execPath, args, {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
  });
}

test("BLOCKER 1: Real schema-026 -> schema-027 upgrade proof with João declined + Carlos accepted on same search", async () => {
  // 1. Roll back to schema 026
  await rollbackThrough("027_add_connection_lifecycle_v2");

  // 2. Assert pre-migration state (schema 026)
  const is026Applied = (await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM pgmigrations WHERE name = '026_add_contact_completions'"
  )).rows[0].cnt;
  assert.equal(is026Applied, 1, "026_add_contact_completions must exist in pgmigrations");

  const is027Applied = (await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM pgmigrations WHERE name = '027_add_connection_lifecycle_v2'"
  )).rows[0].cnt;
  assert.equal(is027Applied, 0, "027_add_connection_lifecycle_v2 must NOT exist in pgmigrations");

  const oldIndexExists = (await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM pg_indexes WHERE indexname = 'contacts_bilateral_search_unique_idx'"
  )).rows[0].cnt;
  assert.equal(oldIndexExists, 1, "contacts_bilateral_search_unique_idx must exist in schema 026");

  const newIndexExists = (await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM pg_indexes WHERE indexname = 'contacts_bilateral_search_professional_unique_idx'"
  )).rows[0].cnt;
  assert.equal(newIndexExists, 0, "contacts_bilateral_search_professional_unique_idx must NOT exist in schema 026");

  const unavailTableExists = (await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM information_schema.tables WHERE table_name = 'professional_unavailability_events'"
  )).rows[0].cnt;
  assert.equal(unavailTableExists, 0, "professional_unavailability_events table must NOT exist in schema 026");

  // 3. Construct a genuine v1-valid historical state under schema 026
  const searchId = randomUUID();
  const joaoId = randomUUID(), carlosId = randomUUID();
  const customerId = randomUUID();
  const joaoPhone = phone(), carlosPhone = phone(), customerPhone = phone();
  const joaoContactId = randomUUID(), carlosContactId = randomUUID();
  const joaoCode = createOpportunityCode(), carlosCode = createOpportunityCode();
  const joaoConvId = randomUUID(), carlosConvId = randomUUID();
  const joaoChoiceId = randomUUID(), carlosChoiceId = randomUUID();
  const joaoInboundId = randomUUID(), carlosInboundId = randomUUID();

  try {
    await query("INSERT INTO customers (id, phone_e164) VALUES ($1, $2)", [customerId, customerPhone]);
    await query("INSERT INTO professionals (id, display_name, slug, phone_e164, status) VALUES ($1::uuid,'João',$1::text,$2,'active')", [joaoId, joaoPhone]);
    await query("INSERT INTO professionals (id, display_name, slug, phone_e164, status) VALUES ($1::uuid,'Carlos',$1::text,$2,'active')", [carlosId, carlosPhone]);
    await query("INSERT INTO search_requests (id, customer_id, raw_text, status) VALUES ($1,$2,'eletricista','selected')", [searchId, customerId]);

    await query(`INSERT INTO search_conversations (id,customer_id,status,original_raw_text,service_text,country_code,limit_value,search_request_id,expires_at,completed_at)
      VALUES ($1,$2,'completed','eletricista','eletricista','BR',3,$3,NOW()+INTERVAL '1 hour',NOW())`, [joaoConvId, customerId, searchId]);
    await query(`INSERT INTO search_conversations (id,customer_id,status,original_raw_text,service_text,country_code,limit_value,search_request_id,expires_at,completed_at)
      VALUES ($1,$2,'completed','eletricista','eletricista','BR',3,$3,NOW()+INTERVAL '1 hour',NOW())`, [carlosConvId, customerId, searchId]);

    await query(`INSERT INTO channel_inbound_messages (id,provider,provider_message_id,phone_e164,raw_text,country_code,limit_value,status,processed_at,result)
      VALUES ($1::uuid,'test',$1::text,$2,'Joao','BR',3,'processed',NOW(),'{}'::jsonb)`, [joaoChoiceId, customerPhone]);
    await query(`INSERT INTO channel_inbound_messages (id,provider,provider_message_id,phone_e164,raw_text,country_code,limit_value,status,processed_at,result)
      VALUES ($1::uuid,'test',$1::text,$2,'Carlos','BR',3,'processed',NOW(),'{}'::jsonb)`, [carlosChoiceId, customerPhone]);

    const joaoSnapshot = {
      public_code: joaoCode, service_name: "eletricista", city: "Sinop", state: "MT",
      neighborhood: null, summary: "Elétrica", professional_name: "João",
      professional_phone_e164: joaoPhone, customer_phone_e164: customerPhone,
      notice_version: "bilateral-v1", notice_outbound_id: randomUUID(),
      notice_sent_at: new Date().toISOString(), choice_inbound_id: joaoChoiceId,
      chosen_at: new Date().toISOString(), consented_at: new Date().toISOString(),
      consent_method: "selection_after_notice"
    };
    const carlosSnapshot = {
      public_code: carlosCode, service_name: "eletricista", city: "Sinop", state: "MT",
      neighborhood: null, summary: "Elétrica", professional_name: "Carlos",
      professional_phone_e164: carlosPhone, customer_phone_e164: customerPhone,
      notice_version: "bilateral-v1", notice_outbound_id: randomUUID(),
      notice_sent_at: new Date().toISOString(), choice_inbound_id: carlosChoiceId,
      chosen_at: new Date().toISOString(), consented_at: new Date().toISOString(),
      consent_method: "selection_after_notice"
    };

    // Insert João as 'declined' (v1 status)
    await query(`INSERT INTO contacts (id,professional_id,customer_id,search_request_id,selection_key,public_code,bilateral_snapshot,selection_conversation_id,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'declined')`,
      [joaoContactId, joaoId, customerId, searchId, joaoChoiceId, joaoCode, JSON.stringify(joaoSnapshot), joaoConvId]);

    await query(`INSERT INTO channel_inbound_messages (id,provider,provider_message_id,phone_e164,raw_text,country_code,limit_value,status,processed_at,result)
      VALUES ($1::uuid,'test',$1::text,$2,'recuso','BR',3,'processed',NOW(),'{}'::jsonb)`, [joaoInboundId, joaoPhone]);
    await query(`INSERT INTO opportunity_response_events (contact_id,professional_id,inbound_id,previous_state,next_state,origin,rule_version)
      VALUES ($1,$2,$3,'requested','declined','channel_inbox','opportunity-response-v1')`,
      [joaoContactId, joaoId, joaoInboundId]);

    // Insert Carlos as 'accepted' (v1 status) for the SAME search_request_id S
    // Schema 026 accepts this because contacts_bilateral_search_unique_idx excludes status = 'declined'.
    await query(`INSERT INTO contacts (id,professional_id,customer_id,search_request_id,selection_key,public_code,bilateral_snapshot,selection_conversation_id,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'accepted')`,
      [carlosContactId, carlosId, customerId, searchId, carlosChoiceId, carlosCode, JSON.stringify(carlosSnapshot), carlosConvId]);

    await query(`INSERT INTO channel_inbound_messages (id,provider,provider_message_id,phone_e164,raw_text,country_code,limit_value,status,processed_at,result)
      VALUES ($1::uuid,'test',$1::text,$2,'aceito','BR',3,'processed',NOW(),'{}'::jsonb)`, [carlosInboundId, carlosPhone]);
    await query(`INSERT INTO opportunity_response_events (contact_id,professional_id,inbound_id,previous_state,next_state,origin,rule_version)
      VALUES ($1,$2,$3,'requested','accepted','channel_inbox','opportunity-response-v1')`,
      [carlosContactId, carlosId, carlosInboundId]);

    // Verify schema 026 contains both contacts
    const v1Contacts = (await query<{ status: string }>("SELECT status FROM contacts WHERE search_request_id = $1 ORDER BY created_at", [searchId])).rows;
    assert.equal(v1Contacts.length, 2);
    assert.deepEqual(v1Contacts.map((c) => c.status), ["declined", "accepted"]);

    // 4. Execute Migration 027 for REAL!
    await migrateUp(1);

    // 5. Assert post-migration 027 invariants
    const post027Applied = (await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM pgmigrations WHERE name = '027_add_connection_lifecycle_v2'"
    )).rows[0].cnt;
    assert.equal(post027Applied, 1, "027_add_connection_lifecycle_v2 must exist after migrateUp");

    const contacts = (await query<{ professional_id: string; status: string; public_code: string; bilateral_snapshot: unknown }>(
      "SELECT professional_id, status, public_code, bilateral_snapshot FROM contacts WHERE search_request_id = $1 ORDER BY created_at",
      [searchId]
    )).rows;
    assert.equal(contacts.length, 2, "Both contacts must survive migration 027 up");
    assert.deepEqual(contacts.map((c) => c.status), ["shared", "shared"], "Both João and Carlos must be normalized to 'shared'");
    assert.ok(contacts.some((c) => c.public_code === joaoCode));
    assert.ok(contacts.some((c) => c.public_code === carlosCode));
    assert.ok(contacts.every((c) => c.bilateral_snapshot !== null));

    // Legacy opportunity_response_events preserved unchanged
    const events = (await query<{ next_state: string }>(
      "SELECT next_state FROM opportunity_response_events WHERE contact_id IN ($1, $2) ORDER BY created_at",
      [joaoContactId, carlosContactId]
    )).rows;
    assert.equal(events.length, 2);
    assert.deepEqual(events.map((e) => e.next_state), ["declined", "accepted"]);

    // Old partial unique index dropped, new per-professional partial unique index exists
    const oldIdxPost = (await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM pg_indexes WHERE indexname = 'contacts_bilateral_search_unique_idx'"
    )).rows[0].cnt;
    assert.equal(oldIdxPost, 0, "contacts_bilateral_search_unique_idx must be dropped");

    const newIdxPost = (await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM pg_indexes WHERE indexname = 'contacts_bilateral_search_professional_unique_idx'"
    )).rows[0].cnt;
    assert.equal(newIdxPost, 1, "contacts_bilateral_search_professional_unique_idx must exist");

    // Same professional duplicate on same search is rejected
    await assert.rejects(
      query(
        `INSERT INTO contacts (professional_id,customer_id,search_request_id,selection_key,public_code,bilateral_snapshot,selection_conversation_id,status)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,'shared')`,
        [joaoId, customerId, searchId, joaoChoiceId, createOpportunityCode(), JSON.stringify({ ...joaoSnapshot, public_code: createOpportunityCode() }), joaoConvId]
      ),
      (err: unknown) => (err as { code?: string }).code === "23505"
    );

    // Scenario E: Roll back migration 027 (down reconstruction of João declined + Carlos accepted)
    await migrateDown(1);

    const downContacts = (await query<{ status: string; public_code: string }>(
      "SELECT status, public_code FROM contacts WHERE search_request_id = $1 ORDER BY created_at",
      [searchId]
    )).rows;
    assert.equal(downContacts.length, 2);
    assert.equal(downContacts.find((c) => c.public_code === joaoCode)?.status, "declined");
    assert.equal(downContacts.find((c) => c.public_code === carlosCode)?.status, "accepted");

    const oldIdxRestored = (await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM pg_indexes WHERE indexname = 'contacts_bilateral_search_unique_idx'"
    )).rows[0].cnt;
    assert.equal(oldIdxRestored, 1, "contacts_bilateral_search_unique_idx must be recreated on down");
  } finally {
    // Teardown legacy fixture
    await withTransaction(async (db) => {
      await db.query("ALTER TABLE opportunity_response_events DISABLE TRIGGER opportunity_event_immutable");
      await db.query("DELETE FROM opportunity_response_events WHERE contact_id = $1 OR contact_id = $2", [joaoContactId, carlosContactId]);
      await db.query("ALTER TABLE opportunity_response_events ENABLE TRIGGER opportunity_event_immutable");
      await db.query("DELETE FROM contacts WHERE search_request_id = $1", [searchId]);
      await db.query("DELETE FROM channel_inbound_messages WHERE id = $1 OR id = $2 OR id = $3 OR id = $4", [joaoChoiceId, carlosChoiceId, joaoInboundId, carlosInboundId]);
      await db.query("DELETE FROM channel_inbound_messages WHERE phone_e164 = $1", [customerPhone]);
      await db.query("DELETE FROM search_conversations WHERE search_request_id = $1", [searchId]);
      await db.query("DELETE FROM search_requests WHERE id = $1", [searchId]);
      await db.query("DELETE FROM professionals WHERE id = $1 OR id = $2", [joaoId, carlosId]);
      await db.query("DELETE FROM customers WHERE id = $1", [customerId]);
    });
    // Ensure migrations are reapplied to 027 for subsequent tests
    await migrateUp();
  }
});

test("Scenario F: Native v2 bilateral contact blocks rollback with P0027", async () => {
  const customerId = randomUUID(), professionalId = randomUUID(), searchId = randomUUID(), conversationId = randomUUID();
  const contactId = randomUUID(), inboundId = randomUUID();
  const customerPhone = phone(), professionalPhone = phone();
  const code = createOpportunityCode();

  try {
    await query("INSERT INTO customers (id, phone_e164) VALUES ($1, $2)", [customerId, customerPhone]);
    await query("INSERT INTO professionals (id, display_name, slug, phone_e164, status) VALUES ($1::uuid,'V2 Pro',$1::text,$2,'active')", [professionalId, professionalPhone]);
    await query("INSERT INTO search_requests (id, customer_id, raw_text, status) VALUES ($1,$2,'eletricista','selected')", [searchId, customerId]);
    await query(`INSERT INTO search_conversations (id,customer_id,status,original_raw_text,service_text,country_code,limit_value,search_request_id,expires_at,completed_at)
      VALUES ($1,$2,'completed','eletricista','eletricista','BR',3,$3,NOW()+INTERVAL '1 hour',NOW())`, [conversationId, customerId, searchId]);
    await query(`INSERT INTO channel_inbound_messages (id,provider,provider_message_id,phone_e164,raw_text,country_code,limit_value,status,processed_at,result)
      VALUES ($1::uuid,'test',$1::text,$2,'V2 Choice','BR',3,'processed',NOW(),'{}'::jsonb)`, [inboundId, customerPhone]);

    const nativeV2Snapshot = {
      public_code: code, service_name: "eletricista", city: "Sinop", state: "MT",
      neighborhood: null, summary: "Elétrica", professional_name: "V2 Pro",
      professional_phone_e164: professionalPhone, customer_phone_e164: customerPhone,
      notice_version: "bilateral-v1", notice_outbound_id: randomUUID(),
      notice_sent_at: new Date().toISOString(), choice_inbound_id: inboundId,
      chosen_at: new Date().toISOString(), consented_at: new Date().toISOString(),
      consent_method: "selection_after_notice",
      connection_rule_version: "connection-v2", // Native v2 provenance!
    };

    await query(`INSERT INTO contacts (id,professional_id,customer_id,search_request_id,selection_key,public_code,bilateral_snapshot,selection_conversation_id,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'shared')`,
      [contactId, professionalId, customerId, searchId, inboundId, code, JSON.stringify(nativeV2Snapshot), conversationId]);

    // Attempt migration 027 down — must block with P0027
    await assert.rejects(
      () => migrateDown(1),
      (err: unknown) => {
        const e = err as { stderr?: string; message?: string };
        const msg = String(e.stderr || e.message);
        return /CONNECTION_LIFECYCLE_V2_ROLLBACK_BLOCKED|P0027/u.test(msg);
      }
    );

    // Assert native v2 contact and snapshot remain unchanged
    const contactAfter = (await query<{ status: string; bilateral_snapshot: unknown }>("SELECT status, bilateral_snapshot FROM contacts WHERE id = $1", [contactId])).rows[0];
    assert.equal(contactAfter.status, "shared");
    assert.ok(contactAfter.bilateral_snapshot);
  } finally {
    await withTransaction(async (db) => {
      await db.query("DELETE FROM contacts WHERE id = $1", [contactId]);
      await db.query("DELETE FROM channel_inbound_messages WHERE id = $1", [inboundId]);
      await db.query("DELETE FROM search_conversations WHERE id = $1", [conversationId]);
      await db.query("DELETE FROM search_requests WHERE id = $1", [searchId]);
      await db.query("DELETE FROM professionals WHERE id = $1", [professionalId]);
      await db.query("DELETE FROM customers WHERE id = $1", [customerId]);
    });
    await migrateUp();
  }
});

test("Scenario G: Professional unavailability event blocks rollback with P0027", async () => {
  const customerId = randomUUID(), professionalId = randomUUID(), searchId = randomUUID(), conversationId = randomUUID();
  const contactId = randomUUID(), inboundId = randomUUID(), unavailInboundId = randomUUID();
  const customerPhone = phone(), professionalPhone = phone();
  const code = createOpportunityCode();

  try {
    await query("INSERT INTO customers (id, phone_e164) VALUES ($1, $2)", [customerId, customerPhone]);
    await query("INSERT INTO professionals (id, display_name, slug, phone_e164, status) VALUES ($1::uuid,'Unavail Pro',$1::text,$2,'active')", [professionalId, professionalPhone]);
    await query("INSERT INTO search_requests (id, customer_id, raw_text, status) VALUES ($1,$2,'eletricista','selected')", [searchId, customerId]);
    await query(`INSERT INTO search_conversations (id,customer_id,status,original_raw_text,service_text,country_code,limit_value,search_request_id,expires_at,completed_at)
      VALUES ($1,$2,'completed','eletricista','eletricista','BR',3,$3,NOW()+INTERVAL '1 hour',NOW())`, [conversationId, customerId, searchId]);
    await query(`INSERT INTO channel_inbound_messages (id,provider,provider_message_id,phone_e164,raw_text,country_code,limit_value,status,processed_at,result)
      VALUES ($1::uuid,'test',$1::text,$2,'Choice','BR',3,'processed',NOW(),'{}'::jsonb)`, [inboundId, customerPhone]);

    const snapshot = {
      public_code: code, service_name: "eletricista", city: "Sinop", state: "MT",
      neighborhood: null, summary: "Elétrica", professional_name: "Unavail Pro",
      professional_phone_e164: professionalPhone, customer_phone_e164: customerPhone,
      notice_version: "bilateral-v1", notice_outbound_id: randomUUID(),
      notice_sent_at: new Date().toISOString(), choice_inbound_id: inboundId,
      chosen_at: new Date().toISOString(), consented_at: new Date().toISOString(),
      consent_method: "selection_after_notice",
    };

    await query(`INSERT INTO contacts (id,professional_id,customer_id,search_request_id,selection_key,public_code,bilateral_snapshot,selection_conversation_id,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'shared')`,
      [contactId, professionalId, customerId, searchId, inboundId, code, JSON.stringify(snapshot), conversationId]);

    await query(`INSERT INTO channel_inbound_messages (id,provider,provider_message_id,phone_e164,raw_text,country_code,limit_value,status,processed_at,result)
      VALUES ($1::uuid,'test',$1::text,$2,'não posso','BR',3,'processed',NOW(),'{}'::jsonb)`, [unavailInboundId, professionalPhone]);

    await query("ALTER TABLE professional_unavailability_events DISABLE TRIGGER professional_unavailability_events_immutable");
    await query(`INSERT INTO professional_unavailability_events (contact_id, professional_id, inbound_id, origin, rule_version)
      VALUES ($1, $2, $3, 'channel_inbox', 'connection-v2')`, [contactId, professionalId, unavailInboundId]);
    await query("ALTER TABLE professional_unavailability_events ENABLE TRIGGER professional_unavailability_events_immutable");

    // Attempt migration 027 down — must block with P0027
    await assert.rejects(
      () => migrateDown(1),
      (err: unknown) => {
        const e = err as { stderr?: string; message?: string };
        const msg = String(e.stderr || e.message);
        return /CONNECTION_LIFECYCLE_V2_ROLLBACK_BLOCKED|P0027/u.test(msg);
      }
    );
  } finally {
    await withTransaction(async (db) => {
      await db.query("ALTER TABLE professional_unavailability_events DISABLE TRIGGER professional_unavailability_events_immutable");
      await db.query("DELETE FROM professional_unavailability_events WHERE contact_id = $1", [contactId]);
      await db.query("ALTER TABLE professional_unavailability_events ENABLE TRIGGER professional_unavailability_events_immutable");
      await db.query("DELETE FROM contacts WHERE id = $1", [contactId]);
      await db.query("DELETE FROM channel_inbound_messages WHERE id = $1 OR id = $2", [inboundId, unavailInboundId]);
      await db.query("DELETE FROM search_conversations WHERE id = $1", [conversationId]);
      await db.query("DELETE FROM search_requests WHERE id = $1", [searchId]);
      await db.query("DELETE FROM professionals WHERE id = $1", [professionalId]);
      await db.query("DELETE FROM customers WHERE id = $1", [customerId]);
    });
    await migrateUp();
  }
});
