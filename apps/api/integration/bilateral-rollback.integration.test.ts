import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { rollbackThrough } from "./rollback-helper.js";
import { after, test } from "node:test";
import { closeDatabaseConnection, query, withTransaction } from "../src/database/connection.js";

after(closeDatabaseConnection);

async function databaseFingerprint() {
  const result = await query(`SELECT
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM contacts t) contacts,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM channel_outbound_messages t) outbound,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM channel_inbound_messages t) inbound,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM search_conversations t) conversations,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM search_requests t) searches,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM matches t) matches,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM pgmigrations t) migrations,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY table_name, ordinal_position)
      FROM information_schema.columns t WHERE table_schema = 'public') columns,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY indexname) FROM pg_indexes t WHERE schemaname = 'public') indexes,
    (SELECT jsonb_agg(jsonb_build_array(oid, conname, pg_get_constraintdef(oid)) ORDER BY oid)
      FROM pg_constraint WHERE connamespace = 'public'::regnamespace) constraints,
    (SELECT jsonb_agg(jsonb_build_array(oid, tgname, pg_get_triggerdef(oid)) ORDER BY oid)
      FROM pg_trigger WHERE NOT tgisinternal) triggers`);
  // Compare fingerprints rather than printing rows containing phones on failure.
  return createHash("sha256").update(JSON.stringify(result.rows)).digest("hex");
}

for (const protectedData of ["independent", "selection_key", "snapshot", "notice", "pending", "response", "business_key"] as const) {
  test(`migration 014 protects ${protectedData}: real rollback fails without schema/data changes`, async () => {
    const id = randomUUID();
    const customerId = randomUUID();
    const professionalId = randomUUID();
    const searchId = randomUUID();
    const conversationId = randomUUID();
    const inboundId = randomUUID();
    await withTransaction(async (client) => {
      await client.query("INSERT INTO customers (id, phone_e164) VALUES ($1, $2)", [customerId, `+5566${Date.now().toString().slice(-9)}`]);
      await client.query("INSERT INTO professionals (id, display_name, slug, phone_e164) VALUES ($1::uuid, 'Rollback fixture', $1::text, '+5566988888888')", [professionalId]);
      await client.query("INSERT INTO search_requests (id, customer_id, raw_text) VALUES ($1, $2, 'eletricista')", [searchId, customerId]);
      await client.query(`INSERT INTO search_conversations
        (id, customer_id, status, pending_slot, original_raw_text, service_text, country_code, limit_value, expires_at)
        VALUES ($1, $2, 'active', 'location', 'eletricista', 'eletricista', 'BR', 3, NOW() + INTERVAL '1 hour')`, [conversationId, customerId]);
      await client.query(`INSERT INTO channel_inbound_messages
        (id, provider, provider_message_id, phone_e164, raw_text, country_code, limit_value)
        VALUES ($1::uuid, 'test', $1::text, '+5566999999999', '1', 'BR', 3)`, [inboundId]);
      await client.query(`INSERT INTO contacts (id, search_request_id, customer_id, professional_id, selection_key,
        public_code, bilateral_snapshot, selection_conversation_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`, [id, searchId, customerId, professionalId,
        protectedData === "selection_key" || protectedData === "snapshot" ? randomUUID() : null,
        protectedData === "snapshot" ? "CC-23456789" : null,
        protectedData === "snapshot" ? JSON.stringify({ notice_version: "bilateral-v1", consented_at: new Date().toISOString() }) : null,
        protectedData === "snapshot" ? conversationId : null]);
      await client.query(`INSERT INTO channel_outbound_messages
        (id, channel_inbound_message_id, purpose, provider, recipient_phone_e164, text_content,
         status, sent_at, provider_message_id, business_key, bilateral_notice_version)
        VALUES ($1, $2, $3, 'test', '+5566988888888', 'Fixture enviada', 'sent', NOW(), 'already-sent', $4, $5)`,
      [id, protectedData === "independent" ? null : inboundId,
        protectedData === "independent" ? "professional_contact_notification" : "customer_reply",
        protectedData === "business_key" ? `contact:${id}` : null,
        protectedData === "notice" ? "bilateral-v1" : null]);
      if (protectedData === "pending") await client.query("UPDATE search_conversations SET bilateral_pending = '{}'::jsonb WHERE id = $1", [conversationId]);
      if (protectedData === "response") await client.query("UPDATE channel_inbound_messages SET bilateral_response = '{}'::jsonb WHERE id = $1", [inboundId]);
    });
    try {
      const before = await databaseFingerprint();
      let blocked = false;
      try {
        await rollbackThrough("014_add_bilateral_contact");
      } catch (error) {
        assert.ok(error instanceof Error && "stderr" in error);
        assert.match(String(error.stderr), /BILATERAL_ROLLBACK_BLOCKED/);
        assert.match(String(error.stderr), /P0014/);
        blocked = true;
      }
      assert.equal(blocked, true, "rollback must fail with the specific operational barrier");
      assert.equal(await databaseFingerprint(), before, "schema, data, migrations and sent messages must remain byte-equivalent");
    } finally {
      // Only after proving the blocked rollback preserved everything, remove this
      // test's own fixtures. Scenario B uses separate compatible data in CI.
      await withTransaction(async (client) => {
        await client.query("DELETE FROM channel_outbound_messages WHERE id = $1", [id]);
        await client.query("DELETE FROM channel_inbound_messages WHERE id = $1", [inboundId]);
        await client.query("DELETE FROM contacts WHERE id = $1", [id]);
        await client.query("DELETE FROM search_conversations WHERE id = $1", [conversationId]);
        await client.query("DELETE FROM search_requests WHERE id = $1", [searchId]);
        await client.query("DELETE FROM professionals WHERE id = $1", [professionalId]);
        await client.query("DELETE FROM customers WHERE id = $1", [customerId]);
      });
    }
  });
}
