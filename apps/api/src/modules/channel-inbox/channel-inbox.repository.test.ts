import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { QueryResultRow } from "pg";
import {
  PostgresChannelInboundMessageRepository,
  type ChannelInboxQuery,
  type ChannelInboxTransaction,
} from "./channel-inbox.repository.js";

const id = randomUUID();
function row(overrides: Record<string, unknown> = {}) {
  return { id, provider: "test", provider_message_id: "msg-001", phone_e164: "+5566999999999", raw_text: "Sinop", country_code: "BR", limit_value: 3, status: "received", customer_id: null, conversation_id: null, search_request_id: null, result: null, error_code: null, processing_token: null, processing_started_at: null, ...overrides };
}
function outboundRow(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(), channel_inbound_message_id: id, provider: "test", recipient_phone_e164: "+5566999999999",
    message_type: "text", text_content: "Em qual cidade você precisa do atendimento?", status: "pending",
    processing_token: null, processing_started_at: null, provider_message_id: null, attempt_count: 0,
    last_error_code: null, sent_at: null, ...overrides,
  };
}
function fake(results: QueryResultRow[][]) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const execute: ChannelInboxQuery = async <T extends QueryResultRow>(text, values = []) => { calls.push({ text, values }); return { rows: (results.shift() ?? []) as T[] }; };
  const transaction: ChannelInboxTransaction = async (callback) => callback({ query: execute });
  return { calls, repository: new PostgresChannelInboundMessageRepository(execute, transaction) };
}

test("inbox repository uses the provider-scoped key and claims with a recoverable lease", async () => {
  const current = fake([[row()], [row({ status: "processing", processing_token: id, processing_started_at: new Date() })], [{ id }], [outboundRow()], [{ id }]]);
  const created = await current.repository.createOrFind({ provider: "test", provider_message_id: "msg-001", phone_e164: "+5566999999999", raw_text: "Sinop", country_code: "BR", limit: 3 });
  assert.equal(created.created, true);
  assert.match(current.calls[0]!.text, /ON CONFLICT \(provider, provider_message_id\) DO NOTHING/u);
  assert.match(current.calls[0]!.text, /phone_e164, raw_text, country_code, limit_value/u);
  assert.equal((await current.repository.claim(id, randomUUID(), 60))?.status, "processing");
  assert.match(current.calls[1]!.text, /status IN \('received', 'failed'\)/u);
  assert.match(current.calls[1]!.text, /processing_started_at <=/u);
  const token = randomUUID();
  const outbound = await current.repository.markProcessedAndCreateOutbound({ id, processingToken: token, result: { customer_id: randomUUID(), route: "started", conversation: { conversation_id: null, conversation_status: "completed", result: { status: "needs_location", stage: "location_resolution", reason: "unresolved", interpretation: { status: "interpreted", raw_text: "x", service_text: "x", location_text: "Sinop", country_code: "BR", interpretation: { service_strategy: "full_message", location_strategy: "locative_phrase" } }, orchestration: null } } } as never, customerId: randomUUID(), conversationId: null, searchRequestId: null, outbound: { channelInboundMessageId: id, provider: "test", recipientPhoneE164: "+5566999999999", textContent: "Em qual cidade você precisa do atendimento?" } });
  assert.equal(outbound?.status, "pending");
  assert.match(current.calls[2]!.text, /result = \$6::jsonb/u);
  assert.match(current.calls[3]!.text, /INSERT INTO channel_outbound_messages/u);
  assert.match(current.calls[3]!.text, /ON CONFLICT \(channel_inbound_message_id\)/u);
  assert.equal(await current.repository.markFailed(id, token, "internal_error"), true);
  assert.match(current.calls[4]!.text, /status = 'failed'/u);
});
