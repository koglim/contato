import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { closeDatabaseConnection, query } from "../src/database/connection.js";
import { PostgresGlobalConversationCommandRepository } from "../src/modules/global-conversation-commands/global-conversation-command.repository.js";
import { DefaultGlobalConversationCommandService } from "../src/modules/global-conversation-commands/global-conversation-command.service.js";
import type { SearchConversationPendingSlot } from "../src/modules/search-conversations/search-conversation.types.js";

type Fixture = {
  customerId: string;
  conversationId: string;
  searchRequestId: string | null;
  cleanup: () => Promise<void>;
};

async function createFixture(pendingSlot: SearchConversationPendingSlot): Promise<Fixture> {
  const customerId = randomUUID();
  const conversationId = randomUUID();
  const searchRequestId = pendingSlot === "selection" ? randomUUID() : null;
  const phoneDigits = customerId.replace(/\D/gu, "").slice(0, 8).padEnd(8, "0");
  await query(`INSERT INTO customers (id, phone_e164) VALUES ($1, $2)`, [customerId, `+5566${phoneDigits}`]);
  if (searchRequestId) {
    await query(`INSERT INTO search_requests (id, customer_id, raw_text) VALUES ($1, $2, $3)`, [
      searchRequestId,
      customerId,
      "preciso de eletricista",
    ]);
  }
  await query(
    `INSERT INTO search_conversations (
       id, customer_id, status, pending_slot, original_raw_text, service_text,
       location_text, country_code, limit_value, last_message_text, search_request_id,
       processing_token, processing_started_at, expires_at
     ) VALUES ($1, $2, 'active', $3, $4, $5, $6, 'BR', 3, $7, $8, $9, NOW(), NOW() + INTERVAL '1 hour')`,
    [
      conversationId,
      customerId,
      pendingSlot,
      "preciso de eletricista em Sinop",
      "eletricista",
      pendingSlot === "location" ? null : "Sinop",
      "mensagem pendente",
      searchRequestId,
      randomUUID(),
    ],
  );
  return {
    customerId,
    conversationId,
    searchRequestId,
    cleanup: async () => {
      await query(`DELETE FROM search_conversations WHERE id = $1`, [conversationId]);
      if (searchRequestId) await query(`DELETE FROM search_requests WHERE id = $1`, [searchRequestId]);
      await query(`DELETE FROM customers WHERE id = $1`, [customerId]);
    },
  };
}

test("global commands cancel every pending slot in PostgreSQL without deleting history", { concurrency: false }, async () => {
  const repository = new PostgresGlobalConversationCommandRepository();
  for (const pendingSlot of ["location", "service", "selection"] as const) {
    const fixture = await createFixture(pendingSlot);
    try {
      const cancelled = await repository.cancelActiveByCustomerId(fixture.customerId);
      assert.deepEqual(cancelled, { id: fixture.conversationId, pendingSlot });
      const state = await query<{
        count: number | string;
        status: string;
        pending_slot: string | null;
        processing_token: string | null;
        processing_started_at: Date | null;
        search_request_id: string | null;
        original_raw_text: string;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM search_conversations WHERE id = $1) AS count,
           status, pending_slot, processing_token, processing_started_at,
           search_request_id, original_raw_text
         FROM search_conversations
        WHERE id = $1`,
        [fixture.conversationId],
      );
      const row = state.rows[0]!;
      assert.equal(Number(row.count), 1);
      assert.equal(row.status, "cancelled");
      assert.equal(row.pending_slot, null);
      assert.equal(row.processing_token, null);
      assert.equal(row.processing_started_at, null);
      assert.equal(row.search_request_id, fixture.searchRequestId);
      assert.equal(row.original_raw_text, "preciso de eletricista em Sinop");
    } finally {
      await fixture.cleanup();
    }
  }
});

test("global command service serializes concurrent cancellations in PostgreSQL", { concurrency: false }, async () => {
  const fixture = await createFixture("selection");
  const repository = new PostgresGlobalConversationCommandRepository();
  const first = new DefaultGlobalConversationCommandService(repository);
  const second = new DefaultGlobalConversationCommandService(repository);
  try {
    const outcomes = await Promise.all([
      first.execute({ customerId: fixture.customerId, command: { kind: "cancel" } }),
      second.execute({ customerId: fixture.customerId, command: { kind: "cancel" } }),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.kind === "cancelled").length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.kind === "no_active_conversation").length, 1);
    const state = await query<{ count: number | string; status: string; pending_slot: string | null }>(
      `SELECT
         (SELECT COUNT(*) FROM search_conversations WHERE id = $1) AS count,
         status, pending_slot
       FROM search_conversations
      WHERE id = $1`,
      [fixture.conversationId],
    );
    assert.equal(Number(state.rows[0]!.count), 1);
    assert.equal(state.rows[0]!.status, "cancelled");
    assert.equal(state.rows[0]!.pending_slot, null);
  } finally {
    await fixture.cleanup();
  }
});

test("global command service restarts by cancelling without creating a new conversation", { concurrency: false }, async () => {
  const fixture = await createFixture("location");
  const service = new DefaultGlobalConversationCommandService(new PostgresGlobalConversationCommandRepository());
  try {
    assert.deepEqual(await service.execute({ customerId: fixture.customerId, command: { kind: "restart" } }), { kind: "restarted" });
    assert.deepEqual(await service.execute({ customerId: fixture.customerId, command: { kind: "restart" } }), { kind: "restarted" });
    const state = await query<{ count: number | string; status: string }>(
      `SELECT (SELECT COUNT(*) FROM search_conversations WHERE customer_id = $1) AS count, status
         FROM search_conversations
        WHERE id = $2`,
      [fixture.customerId, fixture.conversationId],
    );
    assert.equal(Number(state.rows[0]!.count), 1);
    assert.equal(state.rows[0]!.status, "cancelled");
  } finally {
    await fixture.cleanup();
  }
});

after(async () => {
  await closeDatabaseConnection();
});
