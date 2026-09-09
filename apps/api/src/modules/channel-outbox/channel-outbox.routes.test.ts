import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../../app.js";
import type { ChannelOutboundService } from "./channel-outbox.types.js";

const internalApiKey = "test-internal-key";
const outboundId = "11111111-1111-4111-8111-111111111111";

class FakeOutbox implements ChannelOutboundService {
  async queueStatus() { return { items: [] }; }
  async holdDelivery() { return { kind: "response" as const, response: { id: outboundId, status: "processing" as const, delivery_status: "reconciliation_required" as const } }; }
  next = false;
  async claim() {
    return {
      kind: "response" as const,
      response: {
        id: outboundId, status: "processing" as const, attempt_count: 1, purpose: "customer_reply" as const, provider: "test",
        recipient_phone_e164: "+5566999999999", message_type: "text" as const,
        text_content: "Em qual cidade você precisa do atendimento?", processing_token: "22222222-2222-4222-8222-222222222222",
      },
    };
  }
  async markSent() { return { kind: "response" as const, response: { id: outboundId, status: "sent" as const } }; }
  async markFailed() { return { kind: "response" as const, response: { id: outboundId, status: "failed" as const } }; }
  async claimNextPending() {
    if (!this.next) return { kind: "outbound_queue_empty" as const };
    return this.claim();
  }
}

test("queue diagnostics authenticates, disables caching and rejects accidental private fields", async () => {
  const fake = new FakeOutbox();
  let calls = 0;
  fake.queueStatus = async () => { calls += 1; return { items: [] }; };
  const app = buildApp({ channelOutboundService: fake, internalApiKey });
  const url = "/internal/channel/outbound/queue-status";
  try {
    assert.equal((await app.inject({ method: "GET", url })).statusCode, 401);
    assert.equal(calls, 0);
    const result = await app.inject({ method: "GET", url, headers: { "x-internal-key": internalApiKey } });
    assert.equal(result.statusCode, 200);
    assert.equal(result.headers["cache-control"], "no-store");
    assert.deepEqual(result.json(), { items: [] });
    fake.queueStatus = async () => ({ items: [], recipient_phone_e164: "+5566999999999" });
    const invalid = await app.inject({ method: "GET", url, headers: { "x-internal-key": internalApiKey } });
    assert.equal(invalid.statusCode, 500);
    assert.deepEqual(invalid.json(), { error: "internal_error" });
  } finally { await app.close(); }
});

test("outbox routes require auth, validate input and expose recipient only on a claim", async () => {
  const app = buildApp({ channelOutboundService: new FakeOutbox(), internalApiKey });
  const claimUrl = `/internal/channel/outbound/${outboundId}/claim`;
  assert.equal((await app.inject({ method: "POST", url: claimUrl })).statusCode, 401);
  const claim = await app.inject({ method: "POST", url: claimUrl, headers: { "x-internal-key": internalApiKey } });
  assert.equal(claim.statusCode, 200);
  assert.equal(claim.json().recipient_phone_e164, "+5566999999999");
  assert.equal(claim.json().purpose, "customer_reply");

  const sentUrl = `/internal/channel/outbound/${outboundId}/sent`;
  assert.equal((await app.inject({ method: "POST", url: sentUrl, headers: { "x-internal-key": internalApiKey }, payload: { processing_token: "invalid", provider_message_id: "evolution-001" } })).statusCode, 400);
  const sent = await app.inject({ method: "POST", url: sentUrl, headers: { "x-internal-key": internalApiKey }, payload: { processing_token: "22222222-2222-4222-8222-222222222222", provider_message_id: "evolution-001" } });
  assert.deepEqual(sent.json(), { id: outboundId, status: "sent" });
  assert.equal(sent.body.includes("+5566999999999"), false);

  const failedUrl = `/internal/channel/outbound/${outboundId}/failed`;
  assert.equal((await app.inject({ method: "POST", url: failedUrl, headers: { "x-internal-key": internalApiKey }, payload: { processing_token: "22222222-2222-4222-8222-222222222222", error_code: "Error with spaces" } })).statusCode, 400);
  const failed = await app.inject({ method: "POST", url: failedUrl, headers: { "x-internal-key": internalApiKey }, payload: { processing_token: "22222222-2222-4222-8222-222222222222", error_code: "evolution_timeout" } });
  assert.deepEqual(failed.json(), { id: outboundId, status: "failed" });
  await app.close();
});

test("outbox route can claim the next pending message without an outbound id", async () => {
  const fake = new FakeOutbox();
  const app = buildApp({ channelOutboundService: fake, internalApiKey });
  const response = await app.inject({ method: "POST", url: "/internal/channel/outbound/next/claim", headers: { "x-internal-key": internalApiKey } });
  assert.equal(response.statusCode, 204);
  assert.equal(response.body, "");
  fake.next = true;
  const claim = await app.inject({ method: "POST", url: "/internal/channel/outbound/next/claim", headers: { "x-internal-key": internalApiKey } });
  assert.equal(claim.statusCode, 200);
  assert.equal(claim.json().id, outboundId);
  assert.equal(claim.json().purpose, "customer_reply");
  assert.equal(claim.json().recipient_phone_e164, "+5566999999999");
  await app.close();
});

test("delivery hold requires internal authentication and a bounded reason without exposing content", async () => {
  const app = buildApp({ channelOutboundService: new FakeOutbox(), internalApiKey });
  const url = `/internal/channel/outbound/${outboundId}/hold`;
  try {
    const payload = { processing_token: "22222222-2222-4222-8222-222222222222", reason: "transport_outcome_unknown" };
    assert.equal((await app.inject({ method: "POST", url, payload })).statusCode, 401);
    const held = await app.inject({ method: "POST", url, payload, headers: { "x-internal-key": internalApiKey } });
    assert.equal(held.statusCode, 200);
    assert.deepEqual(held.json(), { id: outboundId, status: "processing", delivery_status: "reconciliation_required" });
    assert.equal((await app.inject({ method: "POST", url, payload: { ...payload, reason: "sensitive provider error" }, headers: { "x-internal-key": internalApiKey } })).statusCode, 400);
  } finally { await app.close(); }
});
