import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app.js";
import { closeDatabaseConnection, query } from "../src/database/connection.js";
import { rollbackThrough } from "./rollback-helper.js";

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
    env: process.env,
  });
}

async function cleanReceipts() {
  const receiptsTable = await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM information_schema.tables WHERE table_name = 'channel_outbound_receipts'",
  );
  if (receiptsTable.rows[0]?.cnt > 0) {
    await query("ALTER TABLE channel_outbound_receipts DISABLE TRIGGER channel_outbound_receipts_no_update_or_delete");
    await query("DELETE FROM channel_outbound_receipts");
    await query("ALTER TABLE channel_outbound_receipts ENABLE TRIGGER channel_outbound_receipts_no_update_or_delete");
  }
}

async function cleanAllTestData() {
  await cleanReceipts();
  await query("DELETE FROM channel_outbound_messages WHERE provider LIKE 'test-%' OR recipient_phone_e164 LIKE '+5566999990%'");
  await query("DELETE FROM channel_inbound_messages WHERE provider LIKE 'test-%' OR phone_e164 LIKE '+5566999990%'");
}

before(cleanAllTestData);

after(async () => {
  try {
    await cleanAllTestData();
    await migrateUp();
  } finally {
    await closeDatabaseConnection();
  }
});

test("Migration 030: Schema verification, indexes, constraints and table structure", async () => {
  await migrateUp();

  // 1. Verify pgmigrations entry
  const migrationRow = await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM pgmigrations WHERE name = '030_add_outbound_delivery_receipts'",
  );
  assert.equal(migrationRow.rows[0].cnt, 1, "030_add_outbound_delivery_receipts must be recorded in pgmigrations");

  // 2. Verify table exists
  const tableRow = await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM information_schema.tables WHERE table_name = 'channel_outbound_receipts'",
  );
  assert.equal(tableRow.rows[0].cnt, 1, "channel_outbound_receipts table must exist");

  // 3. Verify columns and data types
  const columns = await query<{ column_name: string; data_type: string; is_nullable: string }>(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_name = 'channel_outbound_receipts'
      ORDER BY ordinal_position`,
  );
  const colMap = new Map(columns.rows.map((r) => [r.column_name, r]));

  assert.ok(colMap.has("id"));
  assert.equal(colMap.get("id")?.data_type, "uuid");
  assert.equal(colMap.get("id")?.is_nullable, "NO");

  assert.ok(colMap.has("outbound_message_id"));
  assert.equal(colMap.get("outbound_message_id")?.data_type, "uuid");
  assert.equal(colMap.get("outbound_message_id")?.is_nullable, "NO");

  assert.ok(colMap.has("provider"));
  assert.equal(colMap.get("provider")?.data_type, "text");
  assert.equal(colMap.get("provider")?.is_nullable, "NO");

  assert.ok(colMap.has("provider_message_id"));
  assert.equal(colMap.get("provider_message_id")?.data_type, "text");
  assert.equal(colMap.get("provider_message_id")?.is_nullable, "NO");

  assert.ok(colMap.has("provider_status"));
  assert.equal(colMap.get("provider_status")?.data_type, "text");
  assert.equal(colMap.get("provider_status")?.is_nullable, "NO");

  assert.ok(colMap.has("normalized_status"));
  assert.equal(colMap.get("normalized_status")?.data_type, "text");
  assert.equal(colMap.get("normalized_status")?.is_nullable, "NO");

  assert.ok(colMap.has("provider_event_at"));
  assert.equal(colMap.get("provider_event_at")?.data_type, "timestamp with time zone");
  assert.equal(colMap.get("provider_event_at")?.is_nullable, "YES");

  assert.ok(colMap.has("provider_error_code"));
  assert.equal(colMap.get("provider_error_code")?.data_type, "text");
  assert.equal(colMap.get("provider_error_code")?.is_nullable, "YES");

  assert.ok(colMap.has("provider_error_reason"));
  assert.equal(colMap.get("provider_error_reason")?.data_type, "text");
  assert.equal(colMap.get("provider_error_reason")?.is_nullable, "YES");

  assert.ok(colMap.has("event_fingerprint"));
  assert.equal(colMap.get("event_fingerprint")?.data_type, "text");
  assert.equal(colMap.get("event_fingerprint")?.is_nullable, "NO");

  assert.ok(colMap.has("received_at"));
  assert.equal(colMap.get("received_at")?.data_type, "timestamp with time zone");
  assert.equal(colMap.get("received_at")?.is_nullable, "NO");

  assert.ok(colMap.has("created_at"));
  assert.equal(colMap.get("created_at")?.data_type, "timestamp with time zone");
  assert.equal(colMap.get("created_at")?.is_nullable, "NO");

  // 4. Verify indexes
  const indexes = await query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'channel_outbound_receipts'`,
  );
  const indexNames = new Set(indexes.rows.map((r) => r.indexname));
  assert.ok(indexNames.has("channel_outbound_receipts_outbound_id_idx"), "outbound_id index must exist");
  assert.ok(indexNames.has("channel_outbound_receipts_provider_msg_id_idx"), "provider_msg_id index must exist");

  // 5. Verify unique constraint on event_fingerprint
  const uniqueIdx = await query<{ cnt: number }>(
    `SELECT count(*)::int AS cnt FROM pg_constraint
      WHERE conrelid = 'channel_outbound_receipts'::regclass
        AND contype = 'u'`,
  );
  assert.ok(uniqueIdx.rows[0].cnt >= 1, "Unique constraint must exist on event_fingerprint");

  // 6. Verify check constraint on normalized_status
  const checkConstraints = await query<{ conname: string }>(
    `SELECT conname FROM pg_constraint
      WHERE conrelid = 'channel_outbound_receipts'::regclass
        AND contype = 'c'`,
  );
  assert.ok(checkConstraints.rows.length >= 3, "Check constraints must be defined on lengths and normalized_status");

  // 7. Verify triggers
  const triggers = await query<{ tgname: string }>(
    `SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'channel_outbound_receipts'::regclass
        AND NOT tgisinternal`,
  );
  const triggerNames = new Set(triggers.rows.map((r) => r.tgname));
  assert.ok(triggerNames.has("channel_outbound_receipts_no_update_or_delete"), "no_update_or_delete trigger must exist");
  assert.ok(triggerNames.has("channel_outbound_receipts_no_truncate"), "no_truncate trigger must exist");
});

test("Migration 030: Immutability triggers protect against UPDATE, DELETE, and TRUNCATE (P0030)", async () => {
  await migrateUp();

  const inboundId = randomUUID();
  const outboundId = randomUUID();
  const receiptId = randomUUID();
  const testPhone = "+5566999990001";
  const fingerprint = "a".repeat(64);

  try {
    await query(
      `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text)
       VALUES ($1, 'test-prov', $2, $3, 'inbound test')`,
      [inboundId, inboundId, testPhone],
    );

    await query(
      `INSERT INTO channel_outbound_messages (id, channel_inbound_message_id, provider, recipient_phone_e164, message_type, text_content, status, provider_message_id)
       VALUES ($1, $2, 'test-prov', $3, 'text', 'outbound test', 'sent', 'test-prov:wamid.123')`,
      [outboundId, inboundId, testPhone],
    );

    await query(
      `INSERT INTO channel_outbound_receipts (
         id, outbound_message_id, provider, provider_message_id,
         provider_status, normalized_status, event_fingerprint
       ) VALUES ($1, $2, 'test-prov', 'test-prov:wamid.123', 'DELIVERY_ACK', 'delivered', $3)`,
      [receiptId, outboundId, fingerprint],
    );

    // 1. UPDATE must fail with P0030 / OUTBOUND_RECEIPT_IMMUTABLE
    await assert.rejects(
      query(
        "UPDATE channel_outbound_receipts SET provider_status = 'tampered' WHERE id = $1",
        [receiptId],
      ),
      (err: unknown) => {
        const pgErr = err as { code?: string; message?: string };
        return pgErr.code === "P0030" || /OUTBOUND_RECEIPT_IMMUTABLE/.test(pgErr.message ?? "");
      },
      "UPDATE must be blocked by immutability trigger",
    );

    // 2. DELETE must fail with P0030 / OUTBOUND_RECEIPT_IMMUTABLE
    await assert.rejects(
      query(
        "DELETE FROM channel_outbound_receipts WHERE id = $1",
        [receiptId],
      ),
      (err: unknown) => {
        const pgErr = err as { code?: string; message?: string };
        return pgErr.code === "P0030" || /OUTBOUND_RECEIPT_IMMUTABLE/.test(pgErr.message ?? "");
      },
      "DELETE must be blocked by immutability trigger",
    );

    // 3. TRUNCATE must fail with P0030 / OUTBOUND_RECEIPT_IMMUTABLE
    await assert.rejects(
      query("TRUNCATE TABLE channel_outbound_receipts"),
      (err: unknown) => {
        const pgErr = err as { code?: string; message?: string };
        return pgErr.code === "P0030" || /OUTBOUND_RECEIPT_IMMUTABLE/.test(pgErr.message ?? "");
      },
      "TRUNCATE must be blocked by immutability trigger",
    );

    // Verify row is unaltered
    const row = await query<{ provider_status: string }>(
      "SELECT provider_status FROM channel_outbound_receipts WHERE id = $1",
      [receiptId],
    );
    assert.equal(row.rows[0]?.provider_status, "DELIVERY_ACK");
  } finally {
    await cleanReceipts();
    await query("DELETE FROM channel_outbound_messages WHERE id = $1", [outboundId]);
    await query("DELETE FROM channel_inbound_messages WHERE id = $1", [inboundId]);
  }
});

test("Migration 030: Protected rollback blocker prevents down migration when receipts exist (P0030)", async () => {
  await migrateUp();

  const inboundId = randomUUID();
  const outboundId = randomUUID();
  const receiptId = randomUUID();
  const testPhone = "+5566999990002";
  const fingerprint = "b".repeat(64);

  try {
    await query(
      `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text)
       VALUES ($1, 'test-prov', $2, $3, 'inbound test')`,
      [inboundId, inboundId, testPhone],
    );

    await query(
      `INSERT INTO channel_outbound_messages (id, channel_inbound_message_id, provider, recipient_phone_e164, message_type, text_content, status, provider_message_id)
       VALUES ($1, $2, 'test-prov', $3, 'text', 'outbound test', 'sent', 'test-prov:wamid.456')`,
      [outboundId, inboundId, testPhone],
    );

    await query(
      `INSERT INTO channel_outbound_receipts (
         id, outbound_message_id, provider, provider_message_id,
         provider_status, normalized_status, event_fingerprint
       ) VALUES ($1, $2, 'test-prov', 'test-prov:wamid.456', 'FAILED', 'failed', $3)`,
      [receiptId, outboundId, fingerprint],
    );

    // Rollback attempt must fail with OUTBOUND_RECEIPT_ROLLBACK_BLOCKED / P0030
    await assert.rejects(
      rollbackThrough("030_add_outbound_delivery_receipts"),
      (err: unknown) => {
        const e = err as { stderr?: string; message?: string };
        const msg = String(e.stderr || e.message);
        return /OUTBOUND_RECEIPT_ROLLBACK_BLOCKED/u.test(msg) && /P0030/u.test(msg);
      },
      "rollbackThrough must be blocked when channel_outbound_receipts contains rows",
    );

    // Verify migration 030 is still recorded and table intact
    const migrationRow = await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM pgmigrations WHERE name = '030_add_outbound_delivery_receipts'",
    );
    assert.equal(migrationRow.rows[0].cnt, 1, "030 must still exist in pgmigrations");

    const receiptCount = await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM channel_outbound_receipts WHERE id = $1",
      [receiptId],
    );
    assert.equal(receiptCount.rows[0].cnt, 1, "Receipt row must survive failed rollback");
  } finally {
    await cleanReceipts();
    await query("DELETE FROM channel_outbound_messages WHERE id = $1", [outboundId]);
    await query("DELETE FROM channel_inbound_messages WHERE id = $1", [inboundId]);
  }
});

test("Migration 030: Compatible rollback succeeds when table is empty and reapplies cleanly", async () => {
  await migrateUp();

  // Ensure table is empty
  await cleanReceipts();

  // Rollback migration 030
  await rollbackThrough("030_add_outbound_delivery_receipts");

  // Verify 030 is removed from pgmigrations
  const is030Applied = (await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM pgmigrations WHERE name = '030_add_outbound_delivery_receipts'",
  )).rows[0].cnt;
  assert.equal(is030Applied, 0, "030 must NOT exist in pgmigrations after down");

  // Verify table is dropped
  const tableExists = (await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM information_schema.tables WHERE table_name = 'channel_outbound_receipts'",
  )).rows[0].cnt;
  assert.equal(tableExists, 0, "channel_outbound_receipts table must be dropped");

  // Reapply migration 030
  await migrateUp(1);

  // Verify 030 is restored
  const is030Restored = (await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM pgmigrations WHERE name = '030_add_outbound_delivery_receipts'",
  )).rows[0].cnt;
  assert.equal(is030Restored, 1, "030 must be restored in pgmigrations");

  const tableRestored = (await query<{ cnt: number }>(
    "SELECT count(*)::int AS cnt FROM information_schema.tables WHERE table_name = 'channel_outbound_receipts'",
  )).rows[0].cnt;
  assert.equal(tableRestored, 1, "channel_outbound_receipts table must be recreated");
});

test("End-to-End: POST /internal/channel/outbound/receipts records delivered, read, failed (131047), unknown and preserves outbox status", async () => {
  await migrateUp();

  const app = buildApp();
  const internalApiKey = process.env.INTERNAL_API_KEY || "contatocerto-internal-key";

  const inboundId = randomUUID();
  const outboundId = randomUUID();
  const testPhone = "+5566999990003";
  const providerMsgId = `test-prov:wamid.${randomUUID()}`;

  try {
    await query(
      `INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text)
       VALUES ($1, 'test-prov', $2, $3, 'inbound e2e')`,
      [inboundId, inboundId, testPhone],
    );

    // Initial outbound message has status = 'sent'
    await query(
      `INSERT INTO channel_outbound_messages (id, channel_inbound_message_id, provider, recipient_phone_e164, message_type, text_content, status, provider_message_id)
       VALUES ($1, $2, 'test-prov', $3, 'text', 'outbound e2e', 'sent', $4)`,
      [outboundId, inboundId, testPhone, providerMsgId],
    );

    // 1. Record 'delivered' receipt
    const deliveredPayload = {
      provider: "test-prov",
      provider_message_id: providerMsgId,
      provider_status: "DELIVERY_ACK",
      normalized_status: "delivered",
      provider_event_at: new Date(1713000000000).toISOString(),
    };

    const resDelivered = await app.inject({
      method: "POST",
      url: "/internal/channel/outbound/receipts",
      headers: { authorization: `Bearer ${internalApiKey}` },
      payload: deliveredPayload,
    });

    assert.equal(resDelivered.statusCode, 200);
    const bodyDelivered = JSON.parse(resDelivered.body);
    assert.equal(bodyDelivered.outcome, "recorded");
    assert.equal(bodyDelivered.outbound_message_id, outboundId);
    assert.equal(bodyDelivered.normalized_status, "delivered");
    assert.equal(bodyDelivered.duplicate, false);

    // CRUCIAL DOMAIN INVARIANT: channel_outbound_messages.status MUST REMAIN 'sent'
    const outboxCheck1 = await query<{ status: string }>(
      "SELECT status FROM channel_outbound_messages WHERE id = $1",
      [outboundId],
    );
    assert.equal(outboxCheck1.rows[0].status, "sent", "channel_outbound_messages.status must NEVER mutate on receipt");

    // 2. Replay identical receipt: must be idempotent duplicate
    const resDuplicate = await app.inject({
      method: "POST",
      url: "/internal/channel/outbound/receipts",
      headers: { authorization: `Bearer ${internalApiKey}` },
      payload: deliveredPayload,
    });

    assert.equal(resDuplicate.statusCode, 200);
    const bodyDuplicate = JSON.parse(resDuplicate.body);
    assert.equal(bodyDuplicate.outcome, "recorded");
    assert.equal(bodyDuplicate.duplicate, true);
    assert.equal(bodyDuplicate.receipt_id, bodyDelivered.receipt_id);

    // Table still has exactly 1 receipt row
    const countCheck1 = await query<{ cnt: number }>(
      "SELECT count(*)::int AS cnt FROM channel_outbound_receipts WHERE outbound_message_id = $1",
      [outboundId],
    );
    assert.equal(countCheck1.rows[0].cnt, 1, "Exactly one receipt row must exist after idempotent replay");

    // 3. Record 'read' receipt
    const readPayload = {
      provider: "test-prov",
      provider_message_id: providerMsgId,
      provider_status: "READ",
      normalized_status: "read",
      provider_event_at: new Date(1713000100000).toISOString(),
    };

    const resRead = await app.inject({
      method: "POST",
      url: "/internal/channel/outbound/receipts",
      headers: { authorization: `Bearer ${internalApiKey}` },
      payload: readPayload,
    });

    assert.equal(resRead.statusCode, 200);
    const bodyRead = JSON.parse(resRead.body);
    assert.equal(bodyRead.outcome, "recorded");
    assert.equal(bodyRead.normalized_status, "read");
    assert.equal(bodyRead.duplicate, false);

    // 4. Record synthetic Meta 131047 failure receipt
    const failedPayload = {
      provider: "test-prov",
      provider_message_id: providerMsgId,
      provider_status: "FAILED",
      normalized_status: "failed",
      provider_event_at: new Date(1713000200000).toISOString(),
      provider_error_code: "131047",
      provider_error_reason: "Message failed to send because more than 24 hours have passed since the customer last replied to this number.",
    };

    const resFailed = await app.inject({
      method: "POST",
      url: "/internal/channel/outbound/receipts",
      headers: { authorization: `Bearer ${internalApiKey}` },
      payload: failedPayload,
    });

    assert.equal(resFailed.statusCode, 200);
    const bodyFailed = JSON.parse(resFailed.body);
    assert.equal(bodyFailed.outcome, "recorded");
    assert.equal(bodyFailed.normalized_status, "failed");
    assert.equal(bodyFailed.duplicate, false);

    // CRUCIAL DOMAIN INVARIANT: channel_outbound_messages.status STILL 'sent' even on async FAILED receipt!
    // No automated retry, no requeue to pending, no status mutation.
    const outboxCheck2 = await query<{ status: string }>(
      "SELECT status FROM channel_outbound_messages WHERE id = $1",
      [outboundId],
    );
    assert.equal(outboxCheck2.rows[0].status, "sent", "channel_outbound_messages.status must remain 'sent' on async failure");

    // 5. Query persisted receipt details to verify fidelity
    const persistedReceipts = await query<{
      normalized_status: string;
      provider_status: string;
      provider_error_code: string | null;
      provider_error_reason: string | null;
    }>(
      `SELECT normalized_status, provider_status, provider_error_code, provider_error_reason
         FROM channel_outbound_receipts
        WHERE outbound_message_id = $1
        ORDER BY created_at ASC`,
      [outboundId],
    );
    assert.equal(persistedReceipts.rows.length, 3);
    assert.equal(persistedReceipts.rows[0].normalized_status, "delivered");
    assert.equal(persistedReceipts.rows[1].normalized_status, "read");
    assert.equal(persistedReceipts.rows[2].normalized_status, "failed");
    assert.equal(persistedReceipts.rows[2].provider_error_code, "131047");
    assert.equal(
      persistedReceipts.rows[2].provider_error_reason,
      "Message failed to send because more than 24 hours have passed since the customer last replied to this number.",
    );

    // 6. Unknown provider_message_id receipt returns 200 with unknown_provider_message_id outcome
    const unknownPayload = {
      provider: "test-prov",
      provider_message_id: "test-prov:wamid.UNKNOWN_NONEXISTENT",
      provider_status: "DELIVERED",
      normalized_status: "delivered",
    };

    const resUnknown = await app.inject({
      method: "POST",
      url: "/internal/channel/outbound/receipts",
      headers: { authorization: `Bearer ${internalApiKey}` },
      payload: unknownPayload,
    });

    assert.equal(resUnknown.statusCode, 200);
    const bodyUnknown = JSON.parse(resUnknown.body);
    assert.deepEqual(bodyUnknown, {
      outcome: "unknown_provider_message_id",
      provider: "test-prov",
      provider_message_id: "test-prov:wamid.UNKNOWN_NONEXISTENT",
    });

    // 7. Validation failure returns 400
    const invalidPayload = {
      provider_message_id: providerMsgId,
      // missing provider
      provider_status: "DELIVERED",
      normalized_status: "delivered",
    };

    const resInvalid = await app.inject({
      method: "POST",
      url: "/internal/channel/outbound/receipts",
      headers: { authorization: `Bearer ${internalApiKey}` },
      payload: invalidPayload,
    });

    assert.equal(resInvalid.statusCode, 400);
  } finally {
    await app.close();
    await cleanReceipts();
    await query("DELETE FROM channel_outbound_messages WHERE id = $1", [outboundId]);
    await query("DELETE FROM channel_inbound_messages WHERE id = $1", [inboundId]);
  }
});
