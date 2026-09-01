import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { QueryResultRow } from "pg";
import { PostgresSearchConversationRepository, type SearchConversationQuery } from "./search-conversation.repository.js";

const conversationId = randomUUID();
const now = new Date("2026-08-31T12:00:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: conversationId,
    customer_id: null,
    status: "active",
    pending_slot: "location",
    original_raw_text: "preciso de eletricista perto daqui",
    service_text: "preciso de eletricista perto daqui",
    location_text: null,
    country_code: "BR",
    limit_value: 3,
    last_message_text: "preciso de eletricista perto daqui",
    search_request_id: null,
    expires_at: new Date("2026-08-31T12:30:00.000Z"),
    created_at: now,
    updated_at: now,
    completed_at: null,
    is_expired: false,
    ...overrides,
  };
}

function fakeDatabase(results: QueryResultRow[][]) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const execute: SearchConversationQuery = async <T extends QueryResultRow>(text: string, values = []) => {
    calls.push({ text, values });
    return { rows: (results.shift() ?? []) as T[] };
  };
  return { calls, repository: new PostgresSearchConversationRepository(execute) };
}

test("search conversation repository creates and maps either pending slot with database TTL", async () => {
  const context = fakeDatabase([[row()]]);
  const created = await context.repository.createPending({
    pendingSlot: "location",
    originalRawText: "preciso de eletricista perto daqui",
    serviceText: "preciso de eletricista perto daqui",
    locationText: null,
    countryCode: "BR",
    limitValue: 3,
    ttlMinutes: 30,
  });
  assert.equal(created.id, conversationId);
  assert.equal(created.pendingSlot, "location");
  assert.equal(created.isExpired, false);
  assert.match(context.calls[0]!.text, /INSERT INTO search_conversations/u);
  assert.match(context.calls[0]!.text, /INTERVAL '1 minute'/u);
  assert.deepEqual(context.calls[0]!.values, [
    null,
    "location",
    "preciso de eletricista perto daqui",
    "preciso de eletricista perto daqui",
    null,
    "BR",
    3,
    30,
  ]);

  const serviceContext = fakeDatabase([[row({ pending_slot: "service", location_text: "Sinop" })]]);
  const pendingService = await serviceContext.repository.createPending({
    pendingSlot: "service",
    originalRawText: "preciso de alguém em Sinop",
    serviceText: "preciso de alguém em Sinop",
    locationText: "Sinop",
    countryCode: "BR",
    limitValue: 4,
    ttlMinutes: 30,
  });
  assert.equal(pendingService.pendingSlot, "service");
  assert.equal(pendingService.locationText, "Sinop");
  assert.deepEqual(serviceContext.calls[0]!.values, [
    null,
    "service",
    "preciso de alguém em Sinop",
    "preciso de alguém em Sinop",
    "Sinop",
    "BR",
    4,
    30,
  ]);
});

test("search conversation repository finds records and exposes database expiration", async () => {
  const context = fakeDatabase([[row({ is_expired: true })], []]);
  const expired = await context.repository.findById(conversationId);
  const missing = await context.repository.findById(randomUUID());
  assert.equal(expired?.isExpired, true);
  assert.equal(missing, null);
  assert.match(context.calls[0]!.text, /expires_at <= NOW\(\)/u);
});

test("search conversation repository expires and finds active conversations by customer", async () => {
  const customerId = randomUUID();
  const context = fakeDatabase([[], [row({ customer_id: customerId })]]);
  await context.repository.expireStaleForCustomer(customerId);
  const active = await context.repository.findActiveByCustomerId(customerId);
  assert.equal(active?.customerId, customerId);
  assert.match(context.calls[0]!.text, /SET status = 'expired'/u);
  assert.match(context.calls[0]!.text, /expires_at <= NOW\(\)/u);
  assert.match(context.calls[1]!.text, /status = 'active' AND expires_at > NOW\(\)/u);
  assert.deepEqual(context.calls[1]!.values, [customerId]);
});

test("search conversation repository claims a conversation without a processing token", async () => {
  const token = randomUUID();
  const context = fakeDatabase([[row()]]);
  assert.equal((await context.repository.claim(conversationId, token, 60))?.id, conversationId);
  assert.match(context.calls[0]!.text, /SET processing_token = \$2, processing_started_at = NOW\(\)/u);
  assert.match(context.calls[0]!.text, /pending_slot IN \('location', 'service'\)/u);
  assert.match(context.calls[0]!.text, /expires_at > NOW\(\)/u);
  assert.deepEqual(context.calls[0]!.values, [conversationId, token, 60]);
});

test("search conversation repository does not reclaim a recent processing lease", async () => {
  const context = fakeDatabase([[]]);
  assert.equal(await context.repository.claim(conversationId, randomUUID(), 60), null);
  assert.match(context.calls[0]!.text, /processing_token IS NULL/u);
  assert.match(context.calls[0]!.text, /processing_started_at <=/u);
  assert.match(context.calls[0]!.text, /\$3 \* INTERVAL '1 second'/u);
});

test("search conversation repository can replace an abandoned processing lease", async () => {
  const replacementToken = randomUUID();
  const context = fakeDatabase([[row()]]);
  assert.equal((await context.repository.claim(conversationId, replacementToken, 60))?.id, conversationId);
  assert.match(context.calls[0]!.text, /processing_token IS NULL\s+OR processing_started_at <=/u);
  assert.deepEqual(context.calls[0]!.values, [conversationId, replacementToken, 60]);
});

test("search conversation repository transitions, completes and releases with the same processing token", async () => {
  const token = randomUUID();
  const searchRequestId = randomUUID();
  const context = fakeDatabase([[{ id: conversationId }], [{ id: conversationId }], []]);

  assert.equal(await context.repository.updatePending({
    id: conversationId,
    processingToken: token,
    pendingSlot: "service",
    serviceText: "preciso de alguém",
    locationText: "Sinop",
    lastMessageText: "Sinop",
    ttlMinutes: 30,
  }), true);
  assert.equal(await context.repository.complete({
    id: conversationId,
    processingToken: token,
    serviceText: "eletricista",
    locationText: "Sinop",
    lastMessageText: "eletricista",
    searchRequestId,
  }), true);
  await context.repository.releaseClaim(conversationId, token);

  assert.match(context.calls[0]!.text, /expires_at = NOW\(\)/u);
  assert.match(context.calls[0]!.text, /pending_slot = \$3/u);
  assert.match(context.calls[0]!.text, /location_text = \$5/u);
  assert.deepEqual(context.calls[0]!.values, [
    conversationId,
    token,
    "service",
    "preciso de alguém",
    "Sinop",
    "Sinop",
    30,
  ]);
  assert.match(context.calls[1]!.text, /status = 'completed'/u);
  assert.match(context.calls[1]!.text, /processing_token = \$2/u);
  assert.deepEqual(context.calls[1]!.values, [
    conversationId,
    token,
    "eletricista",
    "Sinop",
    "eletricista",
    searchRequestId,
  ]);
  assert.match(context.calls[2]!.text, /processing_token = NULL/u);
});
