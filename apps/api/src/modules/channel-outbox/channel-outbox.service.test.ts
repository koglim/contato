import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { DefaultChannelOutboundService } from "./channel-outbox.service.js";
import { OUTBOX_MAX_ATTEMPTS, outboxAttemptIsDeadLetter, outboxRetryBackoffSeconds } from "./channel-outbox.retry.js";
import type { ChannelOutboundMessageRecord, ChannelOutboundMessageRepository } from "./channel-outbox.types.js";

const id = "11111111-1111-4111-8111-111111111111";
const inboundId = "22222222-2222-4222-8222-222222222222";

test("outbox retry policy uses the bounded exponential schedule", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(outboxRetryBackoffSeconds), [30, 60, 120, 240, 480]);
  assert.equal(outboxRetryBackoffSeconds(0), 30);
  assert.equal(outboxRetryBackoffSeconds(99), 480);
  assert.equal(outboxAttemptIsDeadLetter(4), false);
  assert.equal(outboxAttemptIsDeadLetter(5), true);
});

function record(overrides: Partial<ChannelOutboundMessageRecord> = {}): ChannelOutboundMessageRecord {
  return {
    id, channelInboundMessageId: inboundId, purpose: "customer_reply", provider: "test", recipientPhoneE164: "+5566999999999", messageType: "text",
    textContent: "Em qual cidade você precisa do atendimento?", status: "pending", processingToken: null,
    processingStartedAt: null, providerMessageId: null, attemptCount: 0, lastErrorCode: null, sentAt: null, nextAttemptAt: null, ...overrides,
  };
}

class FakeRepository implements ChannelOutboundMessageRepository {
  current: ChannelOutboundMessageRecord | null = record();
  async findById() { return this.current; }
  async findByInboundMessageId() { return this.current; }
  async createOrFindForProcessedInbound() { return this.current ?? record(); }
  async createIndependent() { return this.current ?? record({ purpose: "professional_contact_notification", channelInboundMessageId: null }); }
  async claim(_id: string, token: string) {
    if (!this.current || this.current.status === "sent" || this.current.status === "processing") return null;
    this.current = { ...this.current, status: "processing", processingToken: token, processingStartedAt: new Date(), attemptCount: this.current.attemptCount + 1 };
    return this.current;
  }
  async claimNextPending(token: string) { return this.claim(id, token); }
  async markSent(_id: string, input: { processing_token: string; provider_message_id: string }) {
    if (!this.current || this.current.status !== "processing" || this.current.processingToken !== input.processing_token) return false;
    this.current = { ...this.current, status: "sent", processingToken: null, processingStartedAt: null, providerMessageId: input.provider_message_id, lastErrorCode: null, sentAt: new Date(), nextAttemptAt: null };
    return true;
  }
  async markFailed(_id: string, input: { processing_token: string; error_code: string }) {
    if (!this.current || this.current.status !== "processing" || this.current.processingToken !== input.processing_token) return false;
    const deadLetter = this.current.attemptCount >= OUTBOX_MAX_ATTEMPTS;
    this.current = {
      ...this.current,
      status: deadLetter ? "failed" : "pending",
      processingToken: null,
      processingStartedAt: null,
      lastErrorCode: input.error_code,
      nextAttemptAt: deadLetter ? null : new Date(Date.now() + outboxRetryBackoffSeconds(this.current.attemptCount) * 1000),
    };
    return true;
  }
}

function context() {
  const repository = new FakeRepository();
  return { repository, service: new DefaultChannelOutboundService(repository, { processingLeaseSeconds: 60 }) };
}

test("claim reserves pending and failed messages and increments attempts", async () => {
  const current = context();
  const first = await current.service.claim(id);
  assert.equal(first.kind, "response");
  if (first.kind === "response" && first.response.status === "processing") {
    assert.equal(first.response.attempt_count, 1);
    assert.equal(first.response.recipient_phone_e164, "+5566999999999");
  }
  const token = current.repository.current?.processingToken;
  assert.ok(token);
  assert.equal((await current.service.markFailed(id, { processing_token: token!, error_code: "evolution_timeout" })).kind, "response");
  const retry = await current.service.claim(id);
  assert.equal(retry.kind, "response");
  if (retry.kind === "response" && retry.response.status === "processing") assert.equal(retry.response.attempt_count, 2);
});

test("processing claims block concurrent delivery and sent messages are not reclaimed", async () => {
  const current = context();
  const claim = await current.service.claim(id);
  assert.equal(claim.kind, "response");
  assert.deepEqual(await current.service.claim(id), { kind: "outbound_message_processing" });
  const token = current.repository.current?.processingToken;
  assert.ok(token);
  assert.equal((await current.service.markSent(id, { processing_token: token!, provider_message_id: "evolution-001" })).kind, "response");
  const replay = await current.service.claim(id);
  assert.deepEqual(replay, { kind: "response", response: { id, status: "sent", attempt_count: 1, purpose: "customer_reply" } });
  assert.equal(current.repository.current?.processingToken, null);
  assert.ok(current.repository.current?.sentAt);
});

test("sent and failed mutations protect the current processing token", async () => {
  const current = context();
  await current.service.claim(id);
  assert.deepEqual(
    await current.service.markSent(id, { processing_token: randomUUID(), provider_message_id: "evolution-001" }),
    { kind: "outbound_message_claim_invalid" },
  );
  assert.deepEqual(
    await current.service.markFailed(id, { processing_token: randomUUID(), error_code: "evolution_timeout" }),
    { kind: "outbound_message_claim_invalid" },
  );
});

test("claiming the next message treats an empty queue as a normal state", async () => {
  const current = context();
  current.repository.current = null;
  assert.deepEqual(await current.service.claimNextPending(), { kind: "outbound_queue_empty" });
});

test("transient failure can report pending and the fifth failure remains dead-lettered", async () => {
  const current = context();
  await current.service.claim(id);
  const token = current.repository.current?.processingToken;
  assert.ok(token);
  assert.deepEqual(await current.service.markFailed(id, { processing_token: token!, error_code: "temporary_failure" }), {
    kind: "response", response: { id, status: "pending" },
  });
  assert.ok(current.repository.current?.nextAttemptAt);
  current.repository.current = { ...current.repository.current!, status: "processing", processingToken: "retry-token", attemptCount: OUTBOX_MAX_ATTEMPTS };
  assert.deepEqual(await current.service.markFailed(id, { processing_token: "retry-token", error_code: "permanent_failure" }), {
    kind: "response", response: { id, status: "failed" },
  });
});
