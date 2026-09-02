import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { QueryResultRow } from "pg";
import { PostgresChannelOutboundMessageRepository, type ChannelOutboxQuery } from "./channel-outbox.repository.js";

const id = randomUUID();
const inboundId = randomUUID();
const token = randomUUID();

function row(overrides: Record<string, unknown> = {}) {
  return {
    id, channel_inbound_message_id: inboundId, provider: "test", recipient_phone_e164: "+5566999999999",
    message_type: "text", text_content: "Olá", status: "pending", processing_token: null,
    processing_started_at: null, provider_message_id: null, attempt_count: 0, last_error_code: null, sent_at: null,
    ...overrides,
  };
}

function fake(results: QueryResultRow[][]) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const execute: ChannelOutboxQuery = async <T extends QueryResultRow>(text, values = []) => {
    calls.push({ text, values });
    return { rows: (results.shift() ?? []) as T[] };
  };
  return { calls, repository: new PostgresChannelOutboundMessageRepository(execute) };
}

test("outbox repository finds outbound by inbound and claims retryable statuses with a lease", async () => {
  const current = fake([[row()], [row({ status: "processing", processing_token: token, processing_started_at: new Date(), attempt_count: 2 })], [{ id }], [{ id }]]);
  assert.equal((await current.repository.findByInboundMessageId(inboundId))?.id, id);
  assert.equal((await current.repository.claim(id, token, 60))?.attemptCount, 2);
  assert.match(current.calls[1]!.text, /status IN \('pending', 'failed'\)/u);
  assert.match(current.calls[1]!.text, /processing_started_at <=/u);
  assert.match(current.calls[1]!.text, /attempt_count = attempt_count \+ 1/u);
  assert.equal(await current.repository.markSent(id, { processing_token: token, provider_message_id: "evolution-001" }), true);
  assert.match(current.calls[2]!.text, /status = 'sent'/u);
  assert.equal(await current.repository.markFailed(id, { processing_token: token, error_code: "evolution_timeout" }), true);
  assert.match(current.calls[3]!.text, /status = 'failed'/u);
});
