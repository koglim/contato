import assert from "node:assert/strict";
import test from "node:test";
import type {
  ContinueSearchConversationInput,
  ContinueSearchConversationResponse,
  StartSearchConversationInput,
  StartSearchConversationResponse,
} from "@contatocerto/shared";
import { buildApp } from "../../app.js";
import { GeocodingProviderError } from "../location-resolution/location-resolution.types.js";
import type {
  ContinueSearchConversationOutcome,
  SearchConversationService,
  StartSearchConversationOutcome,
} from "./search-conversation.types.js";

const internalApiKey = "test-internal-key";
const conversationId = "11111111-1111-4111-8111-111111111111";
const originalRawText = "preciso de eletricista perto daqui";

const startResponse: StartSearchConversationResponse = {
  conversation_id: conversationId,
  conversation_status: "active",
  pending_slot: "location",
  result: {
    status: "needs_location",
    stage: "interpretation",
    reason: "location_not_understood",
    interpretation: {
      status: "needs_location",
      raw_text: originalRawText,
      service_text: originalRawText,
      location_text: null,
      country_code: "BR",
      interpretation: { service_strategy: "full_message", location_strategy: "none" },
    },
    orchestration: null,
  },
};

const startServiceResponse: StartSearchConversationResponse = {
  conversation_id: conversationId,
  conversation_status: "active",
  pending_slot: "service",
  result: {
    status: "needs_service",
    stage: "service_resolution",
    reason: "unresolved",
    interpretation: {
      status: "interpreted",
      raw_text: "preciso de alguém aqui em Sinop",
      service_text: "preciso de alguém aqui em Sinop",
      location_text: "Sinop",
      country_code: "BR",
      interpretation: { service_strategy: "full_message", location_strategy: "locative_phrase" },
    },
    orchestration: {
      status: "needs_service",
      reason: "unresolved",
      service_resolution: { status: "unresolved", normalized_text: "preciso de alguem", match: null, candidates: [] },
      location_resolution: null,
      matching: null,
    },
  },
};

const continueResponse: ContinueSearchConversationResponse = {
  conversation_id: conversationId,
  conversation_status: "active",
  pending_slot: "location",
  result: {
    status: "needs_location",
    reason: "unresolved",
    service_resolution: {
      status: "resolved",
      normalized_text: "eletricista",
      match: {
        service: { id: "22222222-2222-4222-8222-222222222222", name: "Eletricista", slug: "eletricista" },
        method: "phrase",
        matched_term: "eletricista",
        confidence: 1,
      },
      candidates: [],
    },
    location_resolution: {
      status: "unresolved",
      query: "lugar desconhecido",
      country_code: "BR",
      match: null,
      candidates: [],
      provider: "fake-geocoder",
    },
    matching: null,
  },
};

const continueServiceResponse: ContinueSearchConversationResponse = {
  conversation_id: conversationId,
  conversation_status: "active",
  pending_slot: "service",
  result: {
    status: "needs_service",
    reason: "unresolved",
    service_resolution: { status: "unresolved", normalized_text: "manutencao", match: null, candidates: [] },
    location_resolution: null,
    matching: null,
  },
};

class FakeSearchConversationService implements SearchConversationService {
  startCalls = 0;
  continueCalls = 0;
  startInput: StartSearchConversationInput | undefined;
  continueInput: { id: string; input: ContinueSearchConversationInput } | undefined;
  startOutcome: StartSearchConversationOutcome = { kind: "response", response: startResponse };
  continueOutcome: ContinueSearchConversationOutcome = { kind: "response", response: continueResponse };
  error: Error | undefined;

  async start(input: StartSearchConversationInput) {
    this.startCalls += 1;
    this.startInput = input;
    if (this.error) throw this.error;
    return this.startOutcome;
  }

  async continueConversation(id: string, input: ContinueSearchConversationInput) {
    this.continueCalls += 1;
    this.continueInput = { id, input };
    if (this.error) throw this.error;
    return this.continueOutcome;
  }
}

function context() {
  const service = new FakeSearchConversationService();
  const app = buildApp({ searchConversationService: service, internalApiKey });
  return { app, service };
}

test("search conversation routes require auth, validate inputs and keep health public", async () => {
  const { app, service } = context();
  assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/internal/search/conversations", payload: { raw_text: originalRawText } })).statusCode, 401);
  for (const payload of [{}, { raw_text: " " }, { raw_text: originalRawText, limit: 11 }]) {
    assert.equal((await app.inject({
      method: "POST",
      url: "/internal/search/conversations",
      headers: { "x-internal-key": internalApiKey },
      payload,
    })).statusCode, 400);
  }
  assert.equal((await app.inject({
    method: "POST",
    url: "/internal/search/conversations/not-a-uuid/messages",
    headers: { "x-internal-key": internalApiKey },
    payload: { raw_text: "Sinop" },
  })).statusCode, 400);
  assert.equal((await app.inject({
    method: "POST",
    url: `/internal/search/conversations/${conversationId}/messages`,
    headers: { "x-internal-key": internalApiKey },
    payload: { raw_text: " " },
  })).statusCode, 400);
  assert.equal(service.startCalls, 0);
  assert.equal(service.continueCalls, 0);
  await app.close();
});

test("search conversation start normalizes defaults and returns pending location state", async () => {
  const { app, service } = context();
  const response = await app.inject({
    method: "POST",
    url: "/internal/search/conversations",
    headers: { "x-internal-key": internalApiKey },
    payload: { raw_text: `  ${originalRawText}  `, country_code: "br" },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(service.startInput, { raw_text: originalRawText, country_code: "BR", limit: 3 });
  assert.deepEqual(response.json(), startResponse);
  await app.close();
});

test("search conversation start returns a contract-safe pending service state", async () => {
  const { app, service } = context();
  service.startOutcome = { kind: "response", response: startServiceResponse };
  const response = await app.inject({
    method: "POST",
    url: "/internal/search/conversations",
    headers: { "x-internal-key": internalApiKey },
    payload: { raw_text: "preciso de alguém aqui em Sinop", country_code: "BR" },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), startServiceResponse);
  await app.close();
});

test("search conversation continue maps state errors to stable HTTP responses", async () => {
  for (const [kind, status, error] of [
    ["conversation_not_found", 404, "conversation_not_found"],
    ["conversation_expired", 410, "conversation_expired"],
    ["conversation_not_active", 409, "conversation_not_active"],
    ["conversation_processing", 409, "conversation_processing"],
    ["service_unavailable", 409, "service_unavailable"],
  ] as const) {
    const { app, service } = context();
    service.continueOutcome = { kind };
    const response = await app.inject({
      method: "POST",
      url: `/internal/search/conversations/${conversationId}/messages`,
      headers: { "x-internal-key": internalApiKey },
      payload: { raw_text: "Sinop" },
    });
    assert.equal(response.statusCode, status);
    assert.deepEqual(response.json(), { error });
    await app.close();
  }
});

test("search conversation continue accepts a location reply and returns a contact-free result", async () => {
  const { app, service } = context();
  const response = await app.inject({
    method: "POST",
    url: `/internal/search/conversations/${conversationId}/messages`,
    headers: { "x-internal-key": internalApiKey },
    payload: { raw_text: "  Sinop  " },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(service.continueInput, { id: conversationId, input: { raw_text: "Sinop" } });
  assert.deepEqual(response.json(), continueResponse);
  assert.equal(response.body.includes('"phone"'), false);
  assert.equal(response.body.includes('"email"'), false);
  await app.close();
});

test("search conversation continue accepts the pending service response contract", async () => {
  const { app, service } = context();
  service.continueOutcome = { kind: "response", response: continueServiceResponse };
  const response = await app.inject({
    method: "POST",
    url: `/internal/search/conversations/${conversationId}/messages`,
    headers: { "x-internal-key": internalApiKey },
    payload: { raw_text: "eletricista" },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), continueServiceResponse);
  await app.close();
});

test("search conversation routes preserve geocoding errors without leaking details", async () => {
  for (const [kind, status, error] of [
    ["unavailable", 503, "geocoding_unavailable"],
    ["rate_limited", 429, "geocoding_rate_limited"],
    ["provider_error", 502, "geocoding_provider_error"],
  ] as const) {
    const { app, service } = context();
    service.error = new GeocodingProviderError(kind);
    const response = await app.inject({
      method: "POST",
      url: `/internal/search/conversations/${conversationId}/messages`,
      headers: { "x-internal-key": internalApiKey },
      payload: { raw_text: "Sinop" },
    });
    assert.equal(response.statusCode, status);
    assert.deepEqual(response.json(), { error });
    await app.close();
  }
});
