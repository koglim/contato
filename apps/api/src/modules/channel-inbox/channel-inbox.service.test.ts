import assert from "node:assert/strict";
import test from "node:test";
import type { ChannelInboundMessageInput, CustomerSearchMessageResponse } from "@contatocerto/shared";
import type { CustomerSearchRouter } from "../customer-search/customer-search.types.js";
import { DefaultChannelInboxService } from "./channel-inbox.service.js";
import { DefaultMessagePresenter } from "../message-presentation/message-presentation.service.js";
import type { ChannelOutboundMessageRecord, ChannelOutboundMessageRepository } from "../channel-outbox/channel-outbox.types.js";
import type {
  ChannelInboundMessageRecord,
  ChannelInboundMessageRepository,
  MarkProcessedInboundMessage,
} from "./channel-inbox.types.js";

const messageId = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const searchRequestId = "44444444-4444-4444-8444-444444444444";
const input: ChannelInboundMessageInput = { provider: "test", provider_message_id: "msg-001", phone_e164: "+5566999999999", raw_text: "preciso de eletricista", country_code: "BR", limit: 3 };

function routerResponse(): CustomerSearchMessageResponse {
  return {
    customer_id: customerId,
    route: "continued",
    conversation: {
      conversation_id: conversationId,
      conversation_status: "completed",
      pending_slot: null,
      result: {
        status: "no_matches",
        reason: null,
        service_resolution: { status: "resolved", normalized_text: "eletricista", match: { service: { id: customerId, name: "Eletricista", slug: "eletricista" }, method: "exact", matched_term: "eletricista", confidence: 1 }, candidates: [] },
        location_resolution: { status: "resolved", query: "Sinop", country_code: "BR", match: { label: "Sinop", latitude: -11.86, longitude: -55.5, city: "Sinop", state: "MT", neighborhood: null, country_code: "BR", confidence: 1, layer: "locality" }, candidates: [], provider: "fake" },
        matching: { search_request_id: searchRequestId, status: "ready", service: { id: customerId, name: "Eletricista", slug: "eletricista" }, location: { latitude: -11.86, longitude: -55.5, city: "Sinop", state: "MT", neighborhood: null }, matches: [], meta: { count: 0, limit: 3, availability_freshness_minutes: 240 } },
      },
    },
  } as CustomerSearchMessageResponse;
}

function pendingRouterResponse(): CustomerSearchMessageResponse {
  return {
    customer_id: customerId,
    route: "started",
    conversation: {
      conversation_id: conversationId,
      conversation_status: "active",
      pending_slot: "location",
      result: { status: "needs_location", stage: "interpretation", reason: "location_not_understood", interpretation: { status: "needs_location", raw_text: "preciso de eletricista perto daqui", service_text: "preciso de eletricista perto daqui", location_text: null, country_code: "BR", interpretation: { service_strategy: "full_message", location_strategy: "none" } }, orchestration: null },
    },
  } as CustomerSearchMessageResponse;
}

function record(overrides: Partial<ChannelInboundMessageRecord> = {}): ChannelInboundMessageRecord {
  return { id: messageId, provider: "test", providerMessageId: "msg-001", phoneE164: input.phone_e164, rawText: input.raw_text, countryCode: input.country_code, limitValue: input.limit, status: "received", customerId: null, conversationId: null, searchRequestId: null, result: null, errorCode: null, processingToken: null, processingStartedAt: null, ...overrides };
}

class FakeRepository implements ChannelInboundMessageRepository {
  current = record();
  created = true;
  claimed = true;
  markedProcessed: MarkProcessedInboundMessage | undefined;
  outbound: ChannelOutboundMessageRecord = {
    id: "55555555-5555-4555-8555-555555555555", channelInboundMessageId: messageId, provider: input.provider,
    recipientPhoneE164: input.phone_e164, messageType: "text", textContent: "", status: "pending",
    processingToken: null, processingStartedAt: null, providerMessageId: null, attemptCount: 0, lastErrorCode: null, sentAt: null,
  };
  markedFailed: string | undefined;
  async createOrFind() { return { record: this.current, created: this.created }; }
  async findById() { return this.current; }
  async claim(_id: string, token: string) {
    if (!this.claimed) return null;
    this.claimed = false;
    this.current = { ...this.current, status: "processing", processingToken: token, processingStartedAt: new Date() };
    return this.current;
  }
  async markProcessedAndCreateOutbound(value: MarkProcessedInboundMessage & { outbound: { textContent: string } }) {
    this.markedProcessed = value;
    this.outbound = { ...this.outbound, textContent: value.outbound.textContent };
    this.current = record({ status: "processed", result: value.result, customerId: value.customerId, conversationId: value.conversationId, searchRequestId: value.searchRequestId });
    return this.outbound;
  }
  async markFailed(_id: string, _token: string, code: string) { this.markedFailed = code; this.claimed = true; this.current = record({ status: "failed", errorCode: code }); return true; }
}

class FakeOutboundRepository implements ChannelOutboundMessageRepository {
  current: ChannelOutboundMessageRecord | null;
  constructor(recordValue: ChannelOutboundMessageRecord) { this.current = recordValue; }
  async findById() { return this.current; }
  async findByInboundMessageId() { return this.current; }
  async claim() { return null; }
  async markSent() { return false; }
  async markFailed() { return false; }
}

class FakeRouter implements CustomerSearchRouter {
  calls = 0;
  received: Parameters<CustomerSearchRouter["route"]>[0] | undefined;
  outcome: Awaited<ReturnType<CustomerSearchRouter["route"]>> = { kind: "response", response: routerResponse() };
  started: (() => void) | undefined;
  pending: Promise<void> | undefined;
  async route(inputValue: Parameters<CustomerSearchRouter["route"]>[0]) { this.calls += 1; this.received = inputValue; this.started?.(); await this.pending; return this.outcome; }
}

function context() {
  const repository = new FakeRepository(); const router = new FakeRouter();
  const outbox = new FakeOutboundRepository(repository.outbound);
  return { repository, router, outbox, service: new DefaultChannelInboxService(repository, router, { processingLeaseSeconds: 60 }, new DefaultMessagePresenter(), outbox) };
}

test("channel inbox processes a new message once and persists its routing references", async () => {
  const current = context();
  const outcome = await current.service.receive(input);
  assert.equal(outcome.kind, "response");
  if (outcome.kind === "response") {
    assert.equal(outcome.response.message_id, messageId);
    assert.equal(outcome.response.duplicate, false);
    assert.equal(outcome.response.reply_text.startsWith("Não encontrei profissionais"), true);
    assert.equal(outcome.response.outbound.id, current.repository.outbound.id);
    assert.equal(current.repository.outbound.textContent, outcome.response.reply_text);
    assert.equal(outcome.response.result.customer_id, customerId);
  }
  assert.equal(current.router.calls, 1);
  assert.equal(current.repository.markedProcessed?.customerId, customerId);
  assert.equal(current.repository.markedProcessed?.conversationId, conversationId);
  assert.equal(current.repository.markedProcessed?.searchRequestId, searchRequestId);
});

test("processed duplicate replays only a schema-validated stored result", async () => {
  const current = context();
  current.repository.created = false;
  current.repository.current = record({ status: "processed", result: routerResponse() });
  const outcome = await current.service.receive(input);
  assert.equal(outcome.kind, "response");
  if (outcome.kind === "response") {
    assert.equal(outcome.response.duplicate, true);
    assert.equal(outcome.response.reply_text.startsWith("Não encontrei profissionais"), true);
    assert.equal(outcome.response.outbound.id, current.repository.outbound.id);
  }
  assert.equal(current.router.calls, 0);

  current.repository.current = record({ status: "processed", result: { corrupt: true } });
  assert.deepEqual(await current.service.receive(input), { kind: "channel_message_result_invalid" });
});

test("processed replay keeps the same sent outbound without calling the router", async () => {
  const current = context();
  current.repository.created = false;
  current.repository.current = record({ status: "processed", result: routerResponse() });
  current.outbox.current = { ...current.repository.outbound, status: "sent", providerMessageId: "evolution-001", sentAt: new Date() };
  const outcome = await current.service.receive(input);
  assert.equal(outcome.kind, "response");
  if (outcome.kind === "response") {
    assert.equal(outcome.response.duplicate, true);
    assert.equal(outcome.response.outbound.status, "sent");
  }
  assert.equal(current.router.calls, 0);
});

test("a provider message key is bound to its first normalized payload", async () => {
  const variants = [
    { ...input, raw_text: "eletricista" },
    { ...input, phone_e164: "+5566888888888" },
    { ...input, country_code: "US" },
    { ...input, limit: 4 },
  ];
  for (const variant of variants) {
    const current = context();
    current.repository.created = false;
    current.repository.current = record({ status: "processed", result: routerResponse() });
    assert.deepEqual(await current.service.receive(variant), { kind: "channel_message_payload_conflict" });
    assert.equal(current.router.calls, 0);
  }
});

test("failed and stale processing only reclaim matching payloads and use the claimed record", async () => {
  const current = context();
  current.repository.created = false;
  current.repository.current = record({ status: "failed", rawText: "Sinop", countryCode: "BR", limitValue: 2 });
  const requestWithSamePayload = { ...input, raw_text: "Sinop", limit: 2 };
  assert.equal((await current.service.receive(requestWithSamePayload)).kind, "response");
  assert.deepEqual(current.router.received, { phone_e164: input.phone_e164, raw_text: "Sinop", country_code: "BR", limit: 2 });

  const conflict = context();
  conflict.repository.created = false;
  conflict.repository.current = record({ status: "failed" });
  assert.deepEqual(await conflict.service.receive({ ...input, raw_text: "outro texto" }), { kind: "channel_message_payload_conflict" });
  assert.equal(conflict.router.calls, 0);

  const stale = context();
  stale.repository.created = false;
  stale.repository.current = record({ status: "processing", processingToken: "abandoned", processingStartedAt: new Date(0) });
  assert.equal((await stale.service.receive(input)).kind, "response");
  const staleConflict = context();
  staleConflict.repository.created = false;
  staleConflict.repository.current = record({ status: "processing", processingToken: "abandoned", processingStartedAt: new Date(0) });
  assert.deepEqual(await staleConflict.service.receive({ ...input, raw_text: "outro texto" }), { kind: "channel_message_payload_conflict" });
});

test("channel inbox does not expose raw or service text from pending router results", async () => {
  const current = context();
  current.router.outcome = { kind: "response", response: pendingRouterResponse() };
  const outcome = await current.service.receive(input);
  assert.equal(outcome.kind, "response");
  if (outcome.kind === "response") {
    const body = JSON.stringify(outcome.response);
    assert.equal(body.includes("preciso de eletricista perto daqui"), false);
    const result = outcome.response.result.conversation.result as { interpretation?: Record<string, unknown> };
    assert.equal("raw_text" in (result.interpretation ?? {}), false);
    assert.equal("service_text" in (result.interpretation ?? {}), false);
  }
});

test("message already being processed is not routed twice", async () => {
  const current = context();
  current.repository.created = false;
  current.repository.current = record({ status: "processing", processingToken: "existing", processingStartedAt: new Date() });
  current.repository.claimed = false;
  assert.deepEqual(await current.service.receive(input), { kind: "channel_message_processing" });
  assert.equal(current.router.calls, 0);
});

test("two simultaneous deliveries claim once and call the router once", async () => {
  const current = context();
  let release: (() => void) | undefined;
  current.router.pending = new Promise((resolve) => { release = resolve; });
  const routerStarted = new Promise<void>((resolve) => { current.router.started = resolve; });
  const first = current.service.receive(input);
  await routerStarted;
  const duplicate = await current.service.receive(input);
  assert.deepEqual(duplicate, { kind: "channel_message_processing" });
  assert.equal(current.router.calls, 1);
  release?.();
  assert.equal((await first).kind, "response");
});

test("controlled router failures are persisted as failed and can be reclaimed", async () => {
  const current = context();
  current.router.outcome = { kind: "conversation_processing" };
  assert.deepEqual(await current.service.receive(input), { kind: "conversation_processing" });
  assert.equal(current.repository.markedFailed, "conversation_processing");
  current.router.outcome = { kind: "response", response: routerResponse() };
  const retry = await current.service.receive(input);
  assert.equal(retry.kind, "response");
  assert.equal(current.router.calls, 2);
  assert.equal(current.repository.current.errorCode, null);
});
