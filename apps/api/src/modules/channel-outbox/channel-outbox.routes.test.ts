import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../../app.js";
import type { ChannelOutboundService } from "./channel-outbox.types.js";

const internalApiKey = "test-internal-key";
const outboundId = "11111111-1111-4111-8111-111111111111";

class FakeOutbox implements ChannelOutboundService {
  async claim() {
    return {
      kind: "response" as const,
      response: {
        id: outboundId, status: "processing" as const, attempt_count: 1, provider: "test",
        recipient_phone_e164: "+5566999999999", message_type: "text" as const,
        text_content: "Em qual cidade você precisa do atendimento?", processing_token: "22222222-2222-4222-8222-222222222222",
      },
    };
  }
  async markSent() { return { kind: "response" as const, response: { id: outboundId, status: "sent" as const } }; }
  async markFailed() { return { kind: "response" as const, response: { id: outboundId, status: "failed" as const } }; }
}

test("outbox routes require auth, validate input and expose recipient only on a claim", async () => {
  const app = buildApp({ channelOutboundService: new FakeOutbox(), internalApiKey });
  const claimUrl = `/internal/channel/outbound/${outboundId}/claim`;
  assert.equal((await app.inject({ method: "POST", url: claimUrl })).statusCode, 401);
  const claim = await app.inject({ method: "POST", url: claimUrl, headers: { "x-internal-key": internalApiKey } });
  assert.equal(claim.statusCode, 200);
  assert.equal(claim.json().recipient_phone_e164, "+5566999999999");

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
