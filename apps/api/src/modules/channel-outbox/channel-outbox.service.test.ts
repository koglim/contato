import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { DefaultChannelOutboundService, computeReceiptFingerprint } from "./channel-outbox.service.js";
import { OUTBOX_MAX_ATTEMPTS, outboxAttemptIsDeadLetter, outboxRetryBackoffSeconds } from "./channel-outbox.retry.js";
import type { ChannelOutboundMessageRecord, ChannelOutboundMessageRepository, RecordReceiptResult } from "./channel-outbox.types.js";
import { recordChannelOutboundReceiptSchema, type RecordChannelOutboundReceiptInput } from "@contatocerto/shared";


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
    processingStartedAt: null, providerMessageId: null, attemptCount: 0, lastErrorCode: null, sentAt: null, nextAttemptAt: null,
    administrativeClosedAt: null, ...overrides,
  };
}

class FakeRepository implements ChannelOutboundMessageRepository {
  statusLease: number | undefined;
  async queueStatus(lease: number) { this.statusLease = lease; return { items: [] }; }
  async holdDelivery() { return false; }
  current: ChannelOutboundMessageRecord | null = record();
  async findById() { return this.current; }
  async findByInboundMessageId() { return this.current; }
  async createOrFindForProcessedInbound() { return this.current ?? record(); }
  async createIndependent() { return this.current ?? record({ purpose: "professional_contact_notification", channelInboundMessageId: null }); }
  async claim(_id: string, token: string) {
    if (!this.current || this.current.status === "sent" || this.current.status === "processing"
      || this.current.administrativeClosedAt !== null) return null;
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
  async findByProviderMessageId(provider: string, providerMessageId: string) {
    if (this.current && this.current.provider === provider && this.current.providerMessageId === providerMessageId) {
      return this.current;
    }
    return null;
  }
  recordedReceipts: Array<{ input: RecordChannelOutboundReceiptInput; fingerprint: string; outboundMessageId: string }> = [];
  async recordReceipt(input: RecordChannelOutboundReceiptInput, fingerprint: string, outboundMessageId: string): Promise<RecordReceiptResult> {
    const duplicate = this.recordedReceipts.some((r) => r.fingerprint === fingerprint);
    this.recordedReceipts.push({ input, fingerprint, outboundMessageId });
    return {
      receiptId: "33333333-3333-4333-8333-333333333333",
      outboundMessageId,
      normalizedStatus: input.normalized_status,
      duplicate,
    };
  }
}


function context() {
  const repository = new FakeRepository();
  return { repository, service: new DefaultChannelOutboundService(repository, { processingLeaseSeconds: 60 }) };
}

test("queue diagnostics uses the configured lease without claiming a message", async () => {
  const { repository, service } = context();
  const before = structuredClone(repository.current);
  assert.deepEqual(await service.queueStatus(), { items: [] });
  assert.equal(repository.statusLease, 60);
  assert.deepEqual(repository.current, before);
});

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

test("an administratively expired customer reply has a distinct safe claim outcome", async () => {
  const current = context();
  current.repository.current = record({
    status: "failed",
    lastErrorCode: "customer_reply_expired",
    administrativeClosedAt: new Date(),
  });
  assert.deepEqual(await current.service.claim(id), { kind: "outbound_message_expired" });
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

test("professional_auth_challenge claim transforms to template_authentication interactive payload", async () => {
  const pepper = "a".repeat(64);
  const previousPepper = process.env.PROFESSIONAL_AUTH_PEPPER;
  process.env.PROFESSIONAL_AUTH_PEPPER = pepper;

  try {
    const { encryptAuthEnvelope } = await import("../professional-auth/professional-auth.crypto.js");
    const ciphertext = encryptAuthEnvelope(pepper, "482910");

    const repo = new FakeRepository();
    repo.current = record({
      purpose: "professional_auth_challenge",
      textContent: ciphertext,
      messageType: "text",
      interactivePayload: null,
    });

    const service = new DefaultChannelOutboundService(repo, {
      processingLeaseSeconds: 60,
      authTemplateName: "auth_otp_v1",
      authTemplateLanguage: "pt_BR",
    });

    const claimResult = await service.claim(id);
    assert.equal(claimResult.kind, "response");
    if (claimResult.kind === "response" && claimResult.response.status === "processing") {
      assert.equal(claimResult.response.purpose, "professional_auth_challenge");
      assert.equal(claimResult.response.message_type, "interactive");
      assert.equal(claimResult.response.text_content, "[auth template: auth_otp_v1]");
      assert.deepEqual(claimResult.response.interactive_payload, {
        schema_version: 1,
        type: "template_authentication",
        template_name: "auth_otp_v1",
        language_code: "pt_BR",
        otp_code: "482910",
      });
    }

    // Fails closed if template config is missing
    const serviceNoTemplate = new DefaultChannelOutboundService(repo, {
      processingLeaseSeconds: 60,
    });
    repo.current = record({
      purpose: "professional_auth_challenge",
      textContent: ciphertext,
      messageType: "text",
      interactivePayload: null,
    });
    await assert.rejects(
      async () => serviceNoTemplate.claim(id),
      /WHATSAPP_PROFESSIONAL_AUTH_TEMPLATE_NAME is required/,
    );

    // Fails closed if envelope is corrupt/invalid
    repo.current = record({
      purpose: "professional_auth_challenge",
      textContent: "corrupt_ciphertext",
      messageType: "text",
      interactivePayload: null,
    });
    await assert.rejects(
      async () => service.claim(id),
      /auth_outbox_payload_invalid/,
    );
  } finally {
    process.env.PROFESSIONAL_AUTH_PEPPER = previousPepper;
  }
});

test("computeReceiptFingerprint produces stable 64-char hex SHA-256 excluding received_at", () => {
  const input: RecordChannelOutboundReceiptInput = {
    provider: "evolution",
    provider_message_id: "wamid.synthetic.123",
    provider_status: "DELIVERY_ACK",
    normalized_status: "delivered",
    provider_event_at: "2026-10-14T12:00:00.000Z",
    provider_error_code: null,
    provider_error_reason: null,
  };

  const fp1 = computeReceiptFingerprint(input);
  const fp2 = computeReceiptFingerprint(input);
  assert.equal(fp1, fp2);
  assert.match(fp1, /^[a-f0-9]{64}$/);

  // Different status produces different fingerprint
  const diffStatus = computeReceiptFingerprint({ ...input, normalized_status: "read", provider_status: "READ" });
  assert.notEqual(fp1, diffStatus);

  // Different error code produces different fingerprint
  const diffError = computeReceiptFingerprint({ ...input, provider_error_code: "131047" });
  assert.notEqual(fp1, diffError);
});

test("computeReceiptFingerprint uses canonical JSON serialization and avoids join(':') delimitation ambiguity with valid inputs", () => {
  const inputA = {
    provider: "evolution",
    provider_message_id: "wamid.synthetic:123",
    provider_status: "DELIVERY_ACK",
    normalized_status: "delivered" as const,
  };
  const inputB = {
    provider: "evolution",
    provider_message_id: "wamid.synthetic",
    provider_status: "123:DELIVERY_ACK",
    normalized_status: "delivered" as const,
  };

  // 1. Both inputs are structurally and schema-valid per public API contract
  const parsedA = recordChannelOutboundReceiptSchema.safeParse(inputA);
  const parsedB = recordChannelOutboundReceiptSchema.safeParse(inputB);
  assert.equal(parsedA.success, true, "VALID_INPUT_A_SCHEMA_PARSE=PASS");
  assert.equal(parsedB.success, true, "VALID_INPUT_B_SCHEMA_PARSE=PASS");

  // 2. Demonstrate that legacy naive join(":") would collide on the message_id / status boundary
  const legacyJoinA = [
    inputA.provider,
    inputA.provider_message_id,
    inputA.provider_status,
    inputA.normalized_status,
    null,
    null,
  ].join(":");
  const legacyJoinB = [
    inputB.provider,
    inputB.provider_message_id,
    inputB.provider_status,
    inputB.normalized_status,
    null,
    null,
  ].join(":");
  assert.equal(legacyJoinA, legacyJoinB, "FINGERPRINT_OLD_JOIN_WOULD_COLLIDE=YES");

  // 3. Prove canonical JSON serialization produces distinct fingerprints
  const fpA = computeReceiptFingerprint(inputA);
  const fpB = computeReceiptFingerprint(inputB);

  assert.notEqual(fpA, fpB, "FINGERPRINT_CANONICAL_JSON_DIFFERS=YES");
  assert.match(fpA, /^[a-f0-9]{64}$/);
  assert.match(fpB, /^[a-f0-9]{64}$/);
});

test("recordReceipt records receipt when outbound message is known and identifies duplicates", async () => {
  const current = context();
  current.repository.current = record({
    id,
    provider: "evolution",
    providerMessageId: "wamid.synthetic.123",
    status: "sent",
  });

  const receiptInput: RecordChannelOutboundReceiptInput = {
    provider: "evolution",
    provider_message_id: "wamid.synthetic.123",
    provider_status: "DELIVERY_ACK",
    normalized_status: "delivered",
    provider_event_at: "2026-10-14T12:00:00.000Z",
    provider_error_code: null,
    provider_error_reason: null,
  };

  // First ingestion: duplicate is false
  const outcome1 = await current.service.recordReceipt(receiptInput);
  assert.equal(outcome1.outcome, "recorded");
  if (outcome1.outcome === "recorded") {
    assert.equal(outcome1.outbound_message_id, id);
    assert.equal(outcome1.normalized_status, "delivered");
    assert.equal(outcome1.duplicate, false);
  }

  // Second ingestion with identical payload: duplicate is true
  const outcome2 = await current.service.recordReceipt(receiptInput);
  assert.equal(outcome2.outcome, "recorded");
  if (outcome2.outcome === "recorded") {
    assert.equal(outcome2.outbound_message_id, id);
    assert.equal(outcome2.duplicate, true);
  }

  // Outbound message status in repository remains 'sent'
  assert.equal(current.repository.current?.status, "sent");
});

test("recordReceipt returns unknown_provider_message_id when outbound message not found", async () => {
  const current = context();
  current.repository.current = null; // No message found

  const receiptInput: RecordChannelOutboundReceiptInput = {
    provider: "evolution",
    provider_message_id: "wamid.synthetic.unknown",
    provider_status: "DELIVERY_ACK",
    normalized_status: "delivered",
  };

  const outcome = await current.service.recordReceipt(receiptInput);
  assert.deepEqual(outcome, {
    outcome: "unknown_provider_message_id",
    provider: "evolution",
    provider_message_id: "wamid.synthetic.unknown",
  });
});

test("recordReceipt returns unknown_provider_message_id on provider mismatch", async () => {
  const current = context();
  current.repository.current = record({
    id,
    provider: "evolution",
    providerMessageId: "wamid.synthetic.123",
    status: "sent",
  });

  const receiptInput: RecordChannelOutboundReceiptInput = {
    provider: "outro-provider",
    provider_message_id: "wamid.synthetic.123",
    provider_status: "DELIVERY_ACK",
    normalized_status: "delivered",
  };

  const outcome = await current.service.recordReceipt(receiptInput);
  assert.deepEqual(outcome, {
    outcome: "unknown_provider_message_id",
    provider: "outro-provider",
    provider_message_id: "wamid.synthetic.123",
  });
  // Outbound message remains untouched
  assert.equal(current.repository.current?.status, "sent");
});


