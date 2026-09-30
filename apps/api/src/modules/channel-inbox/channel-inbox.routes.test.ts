import assert from "node:assert/strict";
import test from "node:test";
import type { ChannelInboundMessageInput } from "@contatocerto/shared";
import { buildApp } from "../../app.js";
import type { ChannelInboxService } from "./channel-inbox.types.js";

const internalApiKey = "test-internal-key";
const messageId = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";

class FakeInbox implements ChannelInboxService {
  received: ChannelInboundMessageInput | undefined;
  async receive(input: ChannelInboundMessageInput) {
    this.received = input;
    return { kind: "response", response: {
      message_id: messageId,
      duplicate: false,
      reply_text: "Em qual cidade você precisa do atendimento?",
      outbound: { id: "33333333-3333-4333-8333-333333333333", status: "pending" },
      result: { customer_id: customerId, route: "started", conversation: { conversation_id: messageId, conversation_status: "active", pending_slot: "location", result: { status: "needs_location", stage: "interpretation", reason: "location_not_understood", interpretation: { status: "needs_location", location_text: null, country_code: "BR", interpretation: { service_strategy: "full_message", location_strategy: "none" } }, orchestration: null } } },
    } } as never;
  }
}

test("channel inbox route requires auth, validates inputs and hides inbound PII", async () => {
  const inbox = new FakeInbox(); const app = buildApp({ channelInboxService: inbox, internalApiKey });
  const url = "/internal/channel/inbound/messages";
  const payload = { provider: "TEST", provider_message_id: " msg-001 ", phone_e164: "+5566999999999", raw_text: "  preciso de eletricista  ", country_code: "br" };
  assert.equal((await app.inject({ method: "POST", url, payload })).statusCode, 401);
  for (const invalid of [{ ...payload, phone_e164: "5566999999999" }, { ...payload, provider_message_id: " " }, { ...payload, provider: "not valid" }]) {
    assert.equal((await app.inject({ method: "POST", url, headers: { "x-internal-key": internalApiKey }, payload: invalid })).statusCode, 400);
  }
  const response = await app.inject({ method: "POST", url, headers: { "x-internal-key": internalApiKey }, payload });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(inbox.received, { provider: "test", provider_message_id: "msg-001", phone_e164: "+5566999999999", raw_text: "preciso de eletricista", country_code: "BR", limit: 3 });
  assert.equal(response.body.includes("+5566999999999"), false);
  assert.equal(response.body.includes("preciso de eletricista"), false);
  await app.close();
});

test("channel inbox route returns HTTP 409 on customer_phone_identity_collision", async () => {
  const inbox: ChannelInboxService = {
    async receive() {
      return { kind: "customer_phone_identity_collision" };
    },
  };
  const app = buildApp({ channelInboxService: inbox, internalApiKey });
  const url = "/internal/channel/inbound/messages";
  const payload = { provider: "test", provider_message_id: "msg-collision", phone_e164: "+5566999999999", raw_text: "preciso de eletricista" };
  const response = await app.inject({ method: "POST", url, headers: { "x-internal-key": internalApiKey }, payload });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(JSON.parse(response.body), { error: "customer_phone_identity_collision" });
  await app.close();
});
