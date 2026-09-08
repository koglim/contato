import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { closeDatabaseConnection, query } from "../src/database/connection.js";
import { PostgresChannelOutboundMessageRepository } from "../src/modules/channel-outbox/channel-outbox.repository.js";

after(async () => closeDatabaseConnection());

async function insertIndependent(status: "pending" | "processing" = "pending", processingStartedAt: Date | null = null) {
  const result = await query<{ id: string }>(
    `INSERT INTO channel_outbound_messages (
       purpose, provider, recipient_phone_e164, text_content, status, processing_token, processing_started_at, attempt_count
     ) VALUES ('professional_contact_notification', 'test', $1, 'Mensagem de teste', $2, $3, $4, $5)
     RETURNING id`,
    [
      `+5566${Math.floor(100000000 + Math.random() * 899999999)}`,
      status,
      status === "processing" ? randomUUID() : null,
      processingStartedAt,
      status === "processing" ? 1 : 0,
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
