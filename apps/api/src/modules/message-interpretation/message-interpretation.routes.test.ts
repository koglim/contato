import assert from "node:assert/strict";
import test from "node:test";
import type { MessageInterpretationInput, MessageInterpretationResponse } from "@contatocerto/shared";
import { buildApp } from "../../app.js";
import type { MessageInterpretationService } from "./message-interpretation.types.js";

const internalApiKey = "test-internal-key";

class FakeMessageInterpretationService implements MessageInterpretationService {
  received: MessageInterpretationInput | undefined;
  interpret(input: MessageInterpretationInput): MessageInterpretationResponse {
    this.received = input;
    return {
      status: "needs_location",
      raw_text: input.raw_text,
      service_text: input.raw_text,
      location_text: null,
      country_code: input.country_code,
      interpretation: { service_strategy: "full_message", location_strategy: "none" },
    };
  }
}

test("message interpretation requires the internal key and validates input", async () => {
  const service = new FakeMessageInterpretationService();
  const app = buildApp({ internalApiKey, messageInterpretationService: service });
  assert.equal((await app.inject({ method: "POST", url: "/internal/message-interpretation/interpret", payload: { raw_text: "texto" } })).statusCode, 401);
  for (const payload of [{}, { raw_text: " " }, { raw_text: "texto", country_code: "BRA" }]) {
    assert.equal((await app.inject({ method: "POST", url: "/internal/message-interpretation/interpret", headers: { "x-internal-key": internalApiKey }, payload })).statusCode, 400);
  }
  assert.equal(service.received, undefined);
  await app.close();
});

test("message interpretation trims raw text and normalizes country defaults", async () => {
  const service = new FakeMessageInterpretationService();
  const app = buildApp({ internalApiKey, messageInterpretationService: service });
  const first = await app.inject({ method: "POST", url: "/internal/message-interpretation/interpret", headers: { "x-internal-key": internalApiKey }, payload: { raw_text: "  Minha tomada queimou  " } });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(service.received, { raw_text: "Minha tomada queimou", country_code: "BR" });
  await app.inject({ method: "POST", url: "/internal/message-interpretation/interpret", headers: { "x-internal-key": internalApiKey }, payload: { raw_text: "texto", country_code: "br" } });
  assert.deepEqual(service.received, { raw_text: "texto", country_code: "BR" });
  await app.close();
});
