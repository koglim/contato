import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { closeDatabaseConnection, query } from "../src/database/connection.js";
import { PostgresChannelOutboundMessageRepository } from "../src/modules/channel-outbox/channel-outbox.repository.js";
import { rollbackThrough } from "./rollback-helper.js";
import { buildApp } from "../src/app.js";
import { channelOutboundQueueStatusSchema } from "@contatocerto/shared";

after(async () => closeDatabaseConnection());

test("queue diagnostics reports pending, scheduled, held, expired and dead-letter without mutating or exposing messages", async () => {
  const ids: string[] = [];
  const app = buildApp({ internalApiKey: "queue-diagnostics" });
  const repo = new PostgresChannelOutboundMessageRepository();
  try {
    assert.deepEqual(await repo.queueStatus(60), { items: [] });
    ids.push(await insertIndependent());
    ids.push(await insertIndependent("pending", null, new Date(Date.now() + 120_000)));
    ids.push(await insertIndependent("processing", new Date()));
    ids.push(await insertIndependent("processing", new Date(Date.now() - 120_000)));
    ids.push(await insertIndependent("processing", new Date(Date.now() - 120_000)));
    await query("UPDATE channel_outbound_messages SET delivery_hold_reason = 'transport_outcome_unknown' WHERE id = $1", [ids[4]]);
    ids.push(await insertIndependent());
    await query("UPDATE channel_outbound_messages SET status = 'failed', attempt_count = 5 WHERE id = $1", [ids[5]]);
    ids.push(await insertIndependent());
    const token = randomUUID();
    await repo.claim(ids[6], token, 60);
    assert.equal(await repo.markSent(ids[6], { processing_token: token, provider_message_id: "diagnostic-test" }), true);
    ids.push(await insertIndependent("pending", null, null, "customer_reply"));
    const fingerprint = async () => (await query<{ fingerprint: string }>(
      "SELECT md5(string_agg(to_jsonb(o)::text, '' ORDER BY id)) AS fingerprint FROM channel_outbound_messages o WHERE id = ANY($1::uuid[])", [`{${ids.join(",")}}`],
    )).rows[0].fingerprint;
    const before = await fingerprint();
    const response = await app.inject({ method: "GET", url: "/internal/channel/outbound/queue-status", headers: { "x-internal-key": "queue-diagnostics" } });
    assert.equal(response.statusCode, 200);
    const status = channelOutboundQueueStatusSchema.parse(response.json());
    assert.equal(status.items.length, 2);
    const professional = status.items.find((item) => item.purpose === "professional_contact_notification")!;
    assert.deepEqual({ ...professional, oldest_unfinished_at: undefined }, {
      purpose: "professional_contact_notification", pending: 2, scheduled_retry: 1, processing: 3,
      expired_lease: 1, reconciliation_required: 1, failed: 1, dead_letter: 1, oldest_unfinished_at: undefined,
    });
    assert.equal(status.items.find((item) => item.purpose === "customer_reply")?.pending, 1);
    assert.doesNotMatch(response.body, /phone|text_content|processing_token|Mensagem|[0-9a-f]{8}-[0-9a-f-]{27}/u);
    assert.equal(await fingerprint(), before);
  } finally {
    await app.close();
    await query("DELETE FROM channel_outbound_messages WHERE id = ANY($1::uuid[])", [`{${ids.join(",")}}`]);
    await query("DELETE FROM channel_inbound_recovery_events WHERE inbound_id IN (SELECT id FROM channel_inbound_messages WHERE provider = 'dispatcher-test' AND provider_message_id = ANY($1::text[]))", [`{${ids.join(",")}}`]);
    await query("DELETE FROM channel_inbound_messages WHERE provider = 'dispatcher-test' AND provider_message_id = ANY($1::text[])", [`{${ids.join(",")}}`]);
  }
});

async function insertIndependent(status: "pending" | "processing" = "pending", processingStartedAt: Date | null = null, nextAttemptAt: Date | null = null, purpose: "professional_contact_notification" | "customer_reply" = "professional_contact_notification") {
  const outboundId = randomUUID();
  const inboundId = purpose === "customer_reply" ? randomUUID() : null;
  if (inboundId !== null) {
    await query(`INSERT INTO channel_inbound_messages
      (id, provider, provider_message_id, phone_e164, raw_text, country_code, limit_value)
      VALUES ($1, 'dispatcher-test', $2, '+5566999999999', 'dispatcher fixture', 'BR', 3)`, [inboundId, outboundId]);
  }
  const result = await query<{ id: string }>(
    `INSERT INTO channel_outbound_messages (
       id, purpose, channel_inbound_message_id, provider, recipient_phone_e164, text_content, status, processing_token, processing_started_at, attempt_count, next_attempt_at
     ) VALUES ($1, $2, $3, 'test', $4, 'Mensagem de teste', $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      outboundId,
      purpose,
      inboundId,
      `+5566${Math.floor(100000000 + Math.random() * 899999999)}`,
      status,
      status === "processing" ? randomUUID() : null,
      processingStartedAt,
      status === "processing" ? 1 : 0,
      nextAttemptAt,
    ],
  );
  return result.rows[0]!.id;
}

test("dispatcher claims distinct pending messages concurrently with PostgreSQL row locking", { concurrency: false }, async () => {
  const firstId = await insertIndependent();
  const secondId = await insertIndependent();
  const repository = new PostgresChannelOutboundMessageRepository();
  try {
    const [first, second] = await Promise.all([
      repository.claimNextPending(randomUUID(), 60),
      repository.claimNextPending(randomUUID(), 60),
    ]);
    const claimedIds = [first?.id, second?.id].filter((id): id is string => id !== undefined);
    assert.equal(claimedIds.length, 2);
    assert.deepEqual(new Set(claimedIds), new Set([firstId, secondId]));
    assert.ok(first?.processingToken);
    assert.ok(second?.processingToken);
  } finally {
    await query(`DELETE FROM channel_outbound_messages WHERE id = ANY($1::uuid[])`, [[firstId, secondId] as unknown as string]);
  }
});

test("dispatcher recovers an abandoned processing lease", { concurrency: false }, async () => {
  const staleId = await insertIndependent("processing", new Date(Date.now() - 120_000));
  const repository = new PostgresChannelOutboundMessageRepository();
  try {
    const claimed = await repository.claimNextPending(randomUUID(), 60);
    assert.equal(claimed?.id, staleId);
    assert.equal(claimed?.status, "processing");
    assert.equal(claimed?.attemptCount, 2);
  } finally {
    await query(`DELETE FROM channel_outbound_messages WHERE id = $1`, [staleId]);
  }
});

test("dispatcher skips a future retry and claims it after the scheduled time", { concurrency: false }, async () => {
  const futureId = await insertIndependent("pending", null, new Date(Date.now() + 120_000));
  const repository = new PostgresChannelOutboundMessageRepository();
  try {
    assert.equal(await repository.claimNextPending(randomUUID(), 60), null);
    await query("UPDATE channel_outbound_messages SET next_attempt_at = NOW() - INTERVAL '1 second' WHERE id = $1", [futureId]);
    const claimed = await repository.claimNextPending(randomUUID(), 60);
    assert.equal(claimed?.id, futureId);
    assert.equal(claimed?.nextAttemptAt, null);
  } finally {
    await query(`DELETE FROM channel_outbound_messages WHERE id = $1`, [futureId]);
  }
});

test("dispatcher applies the exponential retry schedule and dead-letters on the fifth attempt", { concurrency: false }, async () => {
  const id = await insertIndependent();
  const repository = new PostgresChannelOutboundMessageRepository();
  try {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const claimed = await repository.claimNextPending(randomUUID(), 60);
      assert.equal(claimed?.id, id);
      const token = claimed!.processingToken!;
      assert.equal(await repository.markFailed(id, { processing_token: token, error_code: "transport_timeout" }), true);
      const current = await repository.findById(id);
      assert.equal(current?.attemptCount, attempt);
      if (attempt < 5) {
        assert.equal(current?.status, "pending");
        assert.ok(current?.nextAttemptAt);
        assert.ok(current.nextAttemptAt.getTime() >= Date.now() + [25_000, 55_000, 115_000, 235_000][attempt - 1]!);
        await query("UPDATE channel_outbound_messages SET next_attempt_at = NOW() - INTERVAL '1 second' WHERE id = $1", [id]);
      } else {
        assert.equal(current?.status, "failed");
        assert.equal(current?.nextAttemptAt, null);
        assert.equal(await repository.claimNextPending(randomUUID(), 60), null);
      }
    }
  } finally {
    await query(`DELETE FROM channel_outbound_messages WHERE id = $1`, [id]);
  }
});

test("dispatcher uses the same claim contract for customer replies and professional notifications", { concurrency: false }, async () => {
  const customerId = await insertIndependent("pending", null, null, "customer_reply");
  const professionalId = await insertIndependent();
  const linkage = await query<{ inbound_id: string | null }>(
    "SELECT channel_inbound_message_id AS inbound_id FROM channel_outbound_messages WHERE id = $1", [customerId],
  );
  const independent = await query<{ inbound_id: string | null }>(
    "SELECT channel_inbound_message_id AS inbound_id FROM channel_outbound_messages WHERE id = $1", [professionalId],
  );
  assert.ok(linkage.rows[0]?.inbound_id);
  assert.equal(independent.rows[0]?.inbound_id, null);
  const repository = new PostgresChannelOutboundMessageRepository();
  try {
    const first = await repository.claimNextPending(randomUUID(), 60);
    const second = await repository.claimNextPending(randomUUID(), 60);
    assert.deepEqual(new Set([first?.id, second?.id]), new Set([customerId, professionalId]));
    assert.deepEqual(new Set([first?.purpose, second?.purpose]), new Set(["customer_reply", "professional_contact_notification"]));
  } finally {
    await query(`DELETE FROM channel_outbound_messages WHERE id = ANY($1::uuid[])`, [[customerId, professionalId] as unknown as string]);
    await query("DELETE FROM channel_inbound_recovery_events WHERE inbound_id IN (SELECT id FROM channel_inbound_messages WHERE provider = 'dispatcher-test' AND provider_message_id = ANY($1::text[]))", [[customerId] as unknown as string]);
    await query("DELETE FROM channel_inbound_messages WHERE provider = 'dispatcher-test' AND provider_message_id = ANY($1::text[])", [[customerId] as unknown as string]);
  }
});

test("independent business key serializes creation and replay preserves an already-sent message", async () => {
  const repository = new PostgresChannelOutboundMessageRepository();
  const businessKey = `contact:${randomUUID()}:initial`;
  const input = { businessKey, purpose: "professional_contact_notification" as const, provider: "test",
    recipientPhoneE164: "+5566988888888", textContent: "Oportunidade de teste" };
  try {
    const [first, second] = await Promise.all([repository.createIndependent(input), repository.createIndependent(input)]);
    assert.equal(first.id, second.id);
    const token = randomUUID();
    await repository.claim(first.id, token, 60);
    assert.equal(await repository.markSent(first.id, { processing_token: token, provider_message_id: "sent-once" }), true);
    const before = await repository.findById(first.id);
    assert.equal((await repository.createIndependent(input)).status, "sent");
    assert.deepEqual(await repository.findById(first.id), before);
    await assert.rejects(repository.createIndependent({ ...input, recipientPhoneE164: "+5566977777777" }), /idempotency conflict/u);
    assert.deepEqual(await repository.findById(first.id), before);
    assert.equal((await query("SELECT id FROM channel_outbound_messages WHERE business_key = $1", [businessKey])).rows.length, 1);
  } finally { await query("DELETE FROM channel_outbound_messages WHERE business_key = $1", [businessKey]); }
});

test("sent confirmation survives a lost response and rejects stale tokens or conflicting provider ids", async () => {
  const id = await insertIndependent();
  const repository = new PostgresChannelOutboundMessageRepository();
  try {
    const token = randomUUID();
    await repository.claim(id, token, 60);
    const input = { processing_token: token, provider_message_id: "provider-accepted-once" };
    assert.deepEqual(await Promise.all([repository.markSent(id, input), repository.markSent(id, input)]), [true, true]);
    const before = await repository.findById(id);
    assert.equal(await repository.markSent(id, input), true);
    assert.equal(await repository.markSent(id, { ...input, processing_token: randomUUID() }), false);
    assert.equal(await repository.markSent(id, { ...input, provider_message_id: "another-send" }), false);
    assert.equal(await repository.markFailed(id, { processing_token: token, error_code: "late_error" }), false);
    assert.deepEqual(await repository.findById(id), before);
    assert.equal(await repository.claim(id, randomUUID(), 60), null);
  } finally { await query("DELETE FROM channel_outbound_messages WHERE id = $1", [id]); }
});

for (const byId of [false, true]) {
  test(`abandoned leases reach an observable terminal state through ${byId ? "id" : "queue"} claim`, async () => {
    const id = await insertIndependent();
    const repository = new PostgresChannelOutboundMessageRepository();
    try {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const claimed = byId ? await repository.claim(id, randomUUID(), 60) : await repository.claimNextPending(randomUUID(), 60);
        assert.equal(claimed?.id, id);
        assert.equal(claimed?.attemptCount, attempt);
        await query("UPDATE channel_outbound_messages SET processing_started_at = NOW() - INTERVAL '2 minutes' WHERE id = $1", [id]);
      }
      assert.equal(byId ? await repository.claim(id, randomUUID(), 60) : await repository.claimNextPending(randomUUID(), 60), null);
      const terminal = await repository.findById(id);
      assert.equal(terminal?.status, "failed");
      assert.equal(terminal?.attemptCount, 5);
      assert.equal(terminal?.lastErrorCode, "lease_attempt_limit");
      assert.equal(terminal?.processingToken, null);
      assert.equal(await repository.claimNextPending(randomUUID(), 60), null);
    } finally { await query("DELETE FROM channel_outbound_messages WHERE id = $1", [id]); }
  });
}

test("messages to the same recipient are delivered in creation order across concurrent consumers", async () => {
  const first = await insertIndependent();
  const second = await insertIndependent();
  const repository = new PostgresChannelOutboundMessageRepository();
  try {
    await query(`UPDATE channel_outbound_messages SET recipient_phone_e164 = '+5566991234567',
      created_at = CASE WHEN id = $1 THEN NOW() - INTERVAL '1 minute' ELSE NOW() END WHERE id IN ($1, $2)`, [first, second]);
    const claimed = await Promise.all([repository.claimNextPending(randomUUID(), 60), repository.claimNextPending(randomUUID(), 60)]);
    assert.deepEqual(claimed.filter(Boolean).map((item) => item!.id), [first]);
    assert.equal(await repository.claim(second, randomUUID(), 60), null);
    const active = claimed.find(Boolean)!;
    assert.equal(await repository.markSent(first, { processing_token: active.processingToken!, provider_message_id: "first" }), true);
    assert.equal((await repository.claimNextPending(randomUUID(), 60))?.id, second);
  } finally { await query("DELETE FROM channel_outbound_messages WHERE id IN ($1, $2)", [first, second]); }
});

test("uncertain delivery is held beyond its lease and only its original token can confirm it", async () => {
  const id = await insertIndependent();
  const repository = new PostgresChannelOutboundMessageRepository();
  try {
    const token = randomUUID();
    await repository.claim(id, token, 60);
    assert.equal(await repository.holdDelivery(id, { processing_token: randomUUID(), reason: "transport_outcome_unknown" }), false);
    const input = { processing_token: token, reason: "transport_outcome_unknown" as const };
    assert.equal(await repository.holdDelivery(id, input), true);
    assert.equal(await repository.holdDelivery(id, input), true);
    await query("UPDATE channel_outbound_messages SET processing_started_at = NOW() - INTERVAL '1 hour' WHERE id = $1", [id]);
    assert.equal(await repository.claimNextPending(randomUUID(), 60), null);
    assert.equal(await repository.claim(id, randomUUID(), 60), null);
    assert.equal(await repository.markFailed(id, { processing_token: token, error_code: "transport_failure" }), false);
    assert.equal((await repository.findById(id))?.attemptCount, 1);
    assert.equal(await repository.markSent(id, { processing_token: token, provider_message_id: "reconciled-provider-id" }), true);
    assert.equal((await repository.findById(id))?.status, "sent");
    assert.equal(await repository.holdDelivery(id, input), false);
  } finally { await query('TRUNCATE channel_transport_events'); await query("DELETE FROM channel_outbound_messages WHERE id = $1", [id]); }
});

for (const state of ["receipt", "hold"] as const) {
  test(`migration 017 preserves ${state}, data and schema when rollback is blocked`, async () => {
    const id = await insertIndependent();
    const repository = new PostgresChannelOutboundMessageRepository();
    try {
      const token = randomUUID();
      await repository.claim(id, token, 60);
      if (state === "receipt") await repository.markSent(id, { processing_token: token, provider_message_id: "receipt" });
      // This fixture isolates the 017 hold constraint, without a 020 audit that must itself block down first.
      else await query("UPDATE channel_outbound_messages SET delivery_hold_reason='confirmation_pending' WHERE id=$1",[id]);
      const fingerprint = async () => (await query(`SELECT
        (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM channel_outbound_messages t) data,
        (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM pgmigrations t) migrations,
        (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY table_name, ordinal_position)::text)
          FROM information_schema.columns t WHERE table_schema = 'public') schema`)).rows;
      const before = await fingerprint();
      await assert.rejects(rollbackThrough("017_add_outbound_delivery_receipt"), (error: unknown) => {
        assert.ok(error instanceof Error && "stderr" in error);
        assert.match(String(error.stderr), /P0017/u);
        assert.match(String(error.stderr), /OUTBOUND_RECEIPT_ROLLBACK_BLOCKED/u);
        return true;
      });
      assert.deepEqual(await fingerprint(), before);
      assert.equal((await query("SELECT name FROM pgmigrations WHERE name = '017_add_outbound_delivery_receipt'")).rows.length, 1);
    } finally { await query("DELETE FROM channel_outbound_messages WHERE id = $1", [id]); }
  });
}
