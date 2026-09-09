import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { QueryResultRow } from "pg";
import { PostgresChannelOutboundMessageRepository, type ChannelOutboxQuery, type ChannelOutboxTransaction } from "./channel-outbox.repository.js";

const id = randomUUID();
const inboundId = randomUUID();
const token = randomUUID();

function row(overrides: Record<string, unknown> = {}) {
  return {
    id, channel_inbound_message_id: inboundId, purpose: "customer_reply", provider: "test", recipient_phone_e164: "+5566999999999",
    message_type: "text", text_content: "Olá", status: "pending", processing_token: null,
    processing_started_at: null, provider_message_id: null, attempt_count: 0, last_error_code: null, sent_at: null, next_attempt_at: null,
    ...overrides,
  };
}

function fake(results: QueryResultRow[][]) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const execute: ChannelOutboxQuery = async <T extends QueryResultRow>(text, values = []) => {
    calls.push({ text, values });
    return { rows: (results.shift() ?? []) as T[] };
  };
  const transaction: ChannelOutboxTransaction = async (callback) => callback({ query: execute });
  return { calls, repository: new PostgresChannelOutboundMessageRepository(execute, transaction) };
}

test("outbox repository recovers one legacy outbound, associates ranked matches, and claims retryable statuses with a lease", async () => {
  const matchId = randomUUID();
  const current = fake([[row()], [row()], [{ id }], [{ id: matchId }], [], [row({ status: "processing", processing_token: token, processing_started_at: new Date(), attempt_count: 2 })], [{ id }], [], [{ id }]]);
  assert.equal((await current.repository.findByInboundMessageId(inboundId))?.id, id);
  const recovered = await current.repository.createOrFindForProcessedInbound({ channelInboundMessageId: inboundId, provider: "test", recipientPhoneE164: "+5566999999999", textContent: "Olá", searchRequestId: randomUUID(), matchIds: [matchId, matchId] });
  assert.equal(recovered.id, id);
  assert.match(current.calls[1]!.text, /INSERT INTO channel_outbound_messages/u);
  assert.match(current.calls[1]!.text, /ON CONFLICT \(channel_inbound_message_id\)/u);
  assert.deepEqual(current.calls[1]!.values, [inboundId, "customer_reply", "test", "+5566999999999", "Olá", null]);
  assert.match(current.calls[2]!.text, /search_requests.*FOR NO KEY UPDATE/u);
  assert.match(current.calls[3]!.text, /search_request_id = \$1/u);
  assert.match(current.calls[3]!.text, /rank_position IS NOT NULL/u);
  assert.match(current.calls[3]!.text, /rank_position <= \$3/u);
  assert.match(current.calls[3]!.text, /pending.shown_at IS NULL/u);
  assert.match(current.calls[4]!.text, /channel_outbound_message_matches/u);
  assert.equal((await current.repository.claim(id, token, 60))?.attemptCount, 2);
  assert.match(current.calls[5]!.text, /status = 'pending'/u);
  assert.match(current.calls[5]!.text, /next_attempt_at IS NULL/u);
  assert.match(current.calls[5]!.text, /processing_started_at <=/u);
  assert.match(current.calls[5]!.text, /attempt_count = attempt_count \+ 1/u);
  assert.equal(await current.repository.markSent(id, { processing_token: token, provider_message_id: "evolution-001" }), true);
  assert.match(current.calls[6]!.text, /status = 'sent'/u);
  assert.match(current.calls[7]!.text, /shown_at = COALESCE\(shown_at, NOW\(\)\)/u);
  assert.equal(await current.repository.markFailed(id, { processing_token: token, error_code: "evolution_timeout" }), true);
  assert.match(current.calls[8]!.text, /CASE WHEN attempt_count >= \$4 THEN 'failed' ELSE 'pending'/u);
  assert.match(current.calls[8]!.text, /next_attempt_at/u);
});

test("outbox repository rejects unranked or foreign matches before creating associations", async () => {
  const current = fake([[row()], []]);
  await assert.rejects(
    current.repository.createOrFindForProcessedInbound({ channelInboundMessageId: inboundId, provider: "test", recipientPhoneE164: "+5566999999999", textContent: "Olá", searchRequestId: randomUUID(), matchIds: [randomUUID()] }),
    /already reserved/u,
  );
  assert.equal(current.calls.filter((call) => /INSERT INTO channel_outbound_message_matches/u.test(call.text)).length, 0);
});

test("outbox repository does not update matches when sent confirmation is invalid or failed", async () => {
  const current = fake([[], [{ id }]]);
  assert.equal(await current.repository.markSent(id, { processing_token: token, provider_message_id: "evolution-001" }), false);
  assert.equal(current.calls.some((call) => /shown_at/u.test(call.text)), false);
  assert.equal(await current.repository.markFailed(id, { processing_token: token, error_code: "evolution_timeout" }), true);
  assert.equal(current.calls.some((call) => /shown_at/u.test(call.text)), false);
});

test("outbox repository creates an independent purpose and atomically claims the next message", async () => {
  const current = fake([
    [row({ id: randomUUID(), channel_inbound_message_id: null, purpose: "professional_contact_notification" })],
    [row({ id: randomUUID(), status: "processing", processing_token: token, processing_started_at: new Date(), attempt_count: 3 })],
  ]);
  const independent = await current.repository.createIndependent({
    businessKey: `contact:${id}:initial`,
    purpose: "professional_contact_notification",
    provider: "test",
    recipientPhoneE164: "+5566999999999",
    textContent: "Um cliente escolheu seu perfil.",
  });
  assert.equal(independent.purpose, "professional_contact_notification");
  assert.equal(independent.channelInboundMessageId, null);
  assert.match(current.calls[0]!.text, /purpose/u);
  assert.match(current.calls[0]!.text, /VALUES \(NULL, \$1, \$2, \$3, \$4, \$5\)/u);

  const claimed = await current.repository.claimNextPending(token, 60);
  assert.equal(claimed?.status, "processing");
  assert.match(current.calls[1]!.text, /FOR UPDATE SKIP LOCKED/u);
  assert.match(current.calls[1]!.text, /processing_started_at <=/u);
  assert.match(current.calls[1]!.text, /RETURNING\s+outbound\.id/u);
  assert.match(current.calls[1]!.text, /outbound\.next_attempt_at/u);
});

test("outbox repository centralizes the retry schedule and dead-letter limit in SQL parameters", async () => {
  const current = fake([[{ id }]]);
  assert.equal(await current.repository.markFailed(id, { processing_token: token, error_code: "transport_timeout" }), true);
  assert.match(current.calls[0]!.text, /WHEN 1 THEN 30/u);
  assert.match(current.calls[0]!.text, /WHEN 2 THEN 60/u);
  assert.match(current.calls[0]!.text, /WHEN 3 THEN 120/u);
  assert.match(current.calls[0]!.text, /WHEN 4 THEN 240/u);
  assert.match(current.calls[0]!.text, /WHEN 5 THEN 480/u);
  assert.deepEqual(current.calls[0]!.values, [id, token, "transport_timeout", 5]);
});
