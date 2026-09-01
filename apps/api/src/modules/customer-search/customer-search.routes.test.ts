import assert from "node:assert/strict";
import test from "node:test";
import type { CustomerSearchMessageInput } from "@contatocerto/shared";
import { buildApp } from "../../app.js";
import type { CustomerSearchRouter } from "./customer-search.types.js";

const internalApiKey = "test-internal-key";
const customerId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";

class FakeRouter implements CustomerSearchRouter {
  received: CustomerSearchMessageInput | undefined;
  async route(input: CustomerSearchMessageInput) {
    this.received = input;
    return { kind: "response", response: {
      customer_id: customerId,
      route: "started",
      conversation: {
        conversation_id: conversationId,
        conversation_status: "active",
        pending_slot: "location",
        result: { status: "needs_location", stage: "interpretation", reason: "location_not_understood", interpretation: { status: "needs_location", raw_text: input.raw_text, service_text: input.raw_text, location_text: null, country_code: input.country_code, interpretation: { service_strategy: "full_message", location_strategy: "none" } }, orchestration: null },
      },
    } } as never;
  }
}

test("customer search route validates canonical E.164, requires auth and never returns the phone", async () => {
  const router = new FakeRouter();
  const app = buildApp({ customerSearchRouter: router, internalApiKey });
  const url = "/internal/customer-search/messages";
  assert.equal((await app.inject({ method: "POST", url, payload: { phone_e164: "+5566999999999", raw_text: "teste" } })).statusCode, 401);
  for (const phone of ["5566999999999", "+0123", "+5566999999999999"]) {
    assert.equal((await app.inject({ method: "POST", url, headers: { "x-internal-key": internalApiKey }, payload: { phone_e164: phone, raw_text: "teste" } })).statusCode, 400);
  }
  const response = await app.inject({ method: "POST", url, headers: { "x-internal-key": internalApiKey }, payload: { phone_e164: "+5566999999999", raw_text: "  preciso de eletricista  ", country_code: "br" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(router.received, { phone_e164: "+5566999999999", raw_text: "preciso de eletricista", country_code: "BR", limit: 3 });
  assert.equal(response.body.includes("+5566999999999"), false);
  await app.close();
});
