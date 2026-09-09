import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { closeDatabaseConnection, query } from "../src/database/connection.js";
import { PostgresChannelOutboundMessageRepository } from "../src/modules/channel-outbox/channel-outbox.repository.js";

after(async () => closeDatabaseConnection());

async function insertIndependent(status: "pending" | "processing" = "pending", processingStartedAt: Date | null = null, nextAttemptAt: Date | null = null, purpose: "professional_contact_notification" | "customer_reply" = "professional_contact_notification") {
  const outboundId = randomUUID();
  const inboundId = randomUUID();
  if (purpose === "customer_reply") {
    await query(`INSERT INTO channel_inbound_messages
      (id, provider, provider_message_id, phone_e164, raw_text, country_code, limit_value)
      VALUES ($1, 'dispatcher-test', $2, '+5566999999999', 'dispatcher fixture', 'BR', 3)`, [inboundId, outboundId]);
  }
  const result = await query<{ id: string }>(
    `INSERT INTO channel_outbound_messages (
       id, purpose, channel_inbound_message_id, provider, recipient_phone_e164, text_content, status, processing_token, processing_started_at, attempt_count, next_attempt_at
     ) VALUES ($1, $2, CASE WHEN $2 = 'customer_reply' THEN $3 ELSE NULL END, 'test', $4, 'Mensagem de teste', $5, $6, $7, $8, $9)
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
  const repository = new PostgresChannelOutboundMessageRepository();
  try {
    const first = await repository.claimNextPending(randomUUID(), 60);
    const second = await repository.claimNextPending(randomUUID(), 60);
    assert.deepEqual(new Set([first?.id, second?.id]), new Set([customerId, professionalId]));
    assert.deepEqual(new Set([first?.purpose, second?.purpose]), new Set(["customer_reply", "professional_contact_notification"]));
  } finally {
    await query(`DELETE FROM channel_outbound_messages WHERE id = ANY($1::uuid[])`, [[customerId, professionalId] as unknown as string]);
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
