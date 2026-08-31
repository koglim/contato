import assert from "node:assert/strict";
import test from "node:test";
import type {
  MessageInterpretationInput,
  MessageInterpretationResponse,
  SearchOrchestrationInput,
} from "@contatocerto/shared";
import { buildApp } from "../../app.js";
import { GeocodingProviderError } from "../location-resolution/location-resolution.types.js";
import type { MessageInterpretationService } from "../message-interpretation/message-interpretation.types.js";
import type {
  MessageLocationFallbackInput,
  MessageLocationFallbackProvider,
  MessageLocationFallbackResult,
} from "../message-interpretation-fallback/message-location-fallback.types.js";
import type { SearchOrchestrationOutcome, SearchOrchestrationService } from "../search-orchestration/search-orchestration.types.js";

const internalApiKey = "test-internal-key";
const serviceResolution = { status: "unresolved" as const, normalized_text: "mensagem", match: null, candidates: [] };

class FakeMessageInterpretationService implements MessageInterpretationService {
  calls = 0;
  received: MessageInterpretationInput | undefined;
  error: Error | undefined;
  response: MessageInterpretationResponse = {
    status: "needs_location",
    raw_text: "mensagem",
    service_text: "mensagem",
    location_text: null,
    country_code: "BR",
    interpretation: { service_strategy: "full_message", location_strategy: "none" },
  };

  interpret(input: MessageInterpretationInput) {
    this.calls += 1;
    this.received = input;
    if (this.error) throw this.error;
    return this.response;
  }
}

class FakeSearchOrchestrationService implements SearchOrchestrationService {
  calls = 0;
  received: SearchOrchestrationInput | undefined;
  error: Error | undefined;
  outcome: SearchOrchestrationOutcome = {
    kind: "response",
    response: { status: "needs_service", reason: "unresolved", service_resolution: serviceResolution, location_resolution: null, matching: null },
  };

  async orchestrate(input: SearchOrchestrationInput) {
    this.calls += 1;
    this.received = input;
    if (this.error) throw this.error;
    return this.outcome;
  }
}

class FakeMessageLocationFallbackProvider implements MessageLocationFallbackProvider {
  readonly name = "fake-location-fallback";
  calls = 0;
  response: MessageLocationFallbackResult = { status: "resolved", location_text: "sinop" };

  async resolve(_input: MessageLocationFallbackInput) {
    this.calls += 1;
    return this.response;
  }
}

function appFor() {
  const interpreter = new FakeMessageInterpretationService();
  const orchestrator = new FakeSearchOrchestrationService();
  const app = buildApp({ internalApiKey, messageInterpretationService: interpreter, searchOrchestrationService: orchestrator });
  return { app, interpreter, orchestrator };
}

function makeInterpreted(rawText: string, countryCode = "BR"): MessageInterpretationResponse {
  return {
    status: "interpreted",
    raw_text: rawText,
    service_text: `slot intacto: ${rawText}`,
    location_text: "sinop",
    country_code: countryCode,
    interpretation: { service_strategy: "full_message", location_strategy: "locative_phrase" },
  };
}

test("message search requires the internal key, validates input and keeps health public", async () => {
  const { app, interpreter, orchestrator } = appFor();
  assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/internal/search/from-message", payload: { raw_text: "mensagem" } })).statusCode, 401);
  for (const payload of [{}, { raw_text: " " }, { raw_text: "mensagem", limit: 11 }]) {
    assert.equal((await app.inject({ method: "POST", url: "/internal/search/from-message", headers: { "x-internal-key": internalApiKey }, payload })).statusCode, 400);
  }
  assert.equal(interpreter.calls, 0);
  assert.equal(orchestrator.calls, 0);
  await app.close();
});

test("message search normalizes request defaults and reuses the injected services", async () => {
  const first = appFor();
  first.interpreter.response = makeInterpreted("mensagem original");
  const defaulted = await first.app.inject({
    method: "POST",
    url: "/internal/search/from-message",
    headers: { "x-internal-key": internalApiKey },
    payload: { raw_text: "  mensagem original  " },
  });
  assert.equal(defaulted.statusCode, 200);
  assert.deepEqual(first.interpreter.received, { raw_text: "mensagem original", country_code: "BR" });
  assert.deepEqual(first.orchestrator.received, {
    raw_text: "mensagem original",
    service_text: "slot intacto: mensagem original",
    location_text: "sinop",
    country_code: "BR",
    limit: 3,
  });
  assert.equal(first.interpreter.calls, 1);
  assert.equal(first.orchestrator.calls, 1);
  await first.app.close();

  const second = appFor();
  second.interpreter.response = makeInterpreted("outra mensagem");
  await second.app.inject({
    method: "POST",
    url: "/internal/search/from-message",
    headers: { "x-internal-key": internalApiKey },
    payload: { raw_text: "outra mensagem", country_code: "br", limit: 7 },
  });
  assert.deepEqual(second.interpreter.received, { raw_text: "outra mensagem", country_code: "BR" });
  assert.equal(second.orchestrator.received?.country_code, "BR");
  assert.equal(second.orchestrator.received?.limit, 7);
  await second.app.close();
});

test("message search route returns the interpretation short circuit without orchestration", async () => {
  const { app, interpreter, orchestrator } = appFor();
  const result = await app.inject({
    method: "POST",
    url: "/internal/search/from-message",
    headers: { "x-internal-key": internalApiKey },
    payload: { raw_text: "preciso de eletricista em sinop" },
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.json(), {
    status: "needs_location",
    stage: "interpretation",
    reason: "missing_explicit_location",
    interpretation: interpreter.response,
    orchestration: null,
  });
  assert.equal(interpreter.calls, 1);
  assert.equal(orchestrator.calls, 0);
  await app.close();
});

test("message search route uses the enabled fallback while the deterministic endpoint remains pure", async () => {
  const interpreter = new FakeMessageInterpretationService();
  interpreter.response = {
    ...interpreter.response,
    raw_text: "preciso de eletricista em sinop",
    service_text: "preciso de eletricista em sinop",
  };
  const orchestrator = new FakeSearchOrchestrationService();
  const fallback = new FakeMessageLocationFallbackProvider();
  const config = { enabled: true, apiKey: undefined, model: "test-model", timeoutMs: 100 };
  const app = buildApp({
    internalApiKey,
    messageInterpretationService: interpreter,
    searchOrchestrationService: orchestrator,
    messageLocationFallbackProvider: fallback,
    messageInterpretationFallbackConfig: config,
  });

  const deterministic = await app.inject({
    method: "POST",
    url: "/internal/message-interpretation/interpret",
    headers: { "x-internal-key": internalApiKey },
    payload: { raw_text: "preciso de eletricista em sinop" },
  });
  assert.equal(deterministic.statusCode, 200);
  assert.equal(deterministic.json().status, "needs_location");
  assert.equal(fallback.calls, 0);

  const hybrid = await app.inject({
    method: "POST",
    url: "/internal/search/from-message",
    headers: { "x-internal-key": internalApiKey },
    payload: { raw_text: "preciso de eletricista em sinop", country_code: "br", limit: 6 },
  });
  assert.equal(hybrid.statusCode, 200);
  assert.equal(fallback.calls, 1);
  assert.equal(orchestrator.calls, 1);
  assert.deepEqual(orchestrator.received, {
    raw_text: "preciso de eletricista em sinop",
    service_text: "preciso de eletricista em sinop",
    location_text: "sinop",
    country_code: "BR",
    limit: 6,
  });
  assert.equal(hybrid.json().interpretation.interpretation.location_strategy, "llm_fallback");
  await app.close();
});

test("enabled fallback without an API key keeps health available and degrades lazily", async () => {
  const interpreter = new FakeMessageInterpretationService();
  const orchestrator = new FakeSearchOrchestrationService();
  const app = buildApp({
    internalApiKey,
    messageInterpretationService: interpreter,
    searchOrchestrationService: orchestrator,
    messageInterpretationFallbackConfig: { enabled: true, apiKey: undefined, model: "test-model", timeoutMs: 100 },
  });

  assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 200);
  const result = await app.inject({
    method: "POST",
    url: "/internal/search/from-message",
    headers: { "x-internal-key": internalApiKey },
    payload: { raw_text: "preciso de eletricista em sinop" },
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().reason, "fallback_unavailable");
  assert.equal(orchestrator.calls, 0);
  assert.equal(result.body.includes("OPENAI_API_KEY"), false);
  await app.close();
});

test("message search route preserves service availability and geocoding errors", async () => {
  const unavailable = appFor();
  unavailable.interpreter.response = makeInterpreted("mensagem");
  unavailable.orchestrator.outcome = { kind: "service_unavailable" };
  const unavailableResult = await unavailable.app.inject({ method: "POST", url: "/internal/search/from-message", headers: { "x-internal-key": internalApiKey }, payload: { raw_text: "mensagem" } });
  assert.equal(unavailableResult.statusCode, 409);
  assert.deepEqual(unavailableResult.json(), { error: "service_unavailable" });
  await unavailable.app.close();

  for (const [kind, status, error] of [
    ["unavailable", 503, "geocoding_unavailable"],
    ["rate_limited", 429, "geocoding_rate_limited"],
    ["provider_error", 502, "geocoding_provider_error"],
  ] as const) {
    const context = appFor();
    context.interpreter.response = makeInterpreted("mensagem");
    context.orchestrator.error = new GeocodingProviderError(kind);
    const result = await context.app.inject({ method: "POST", url: "/internal/search/from-message", headers: { "x-internal-key": internalApiKey }, payload: { raw_text: "mensagem" } });
    assert.equal(result.statusCode, status);
    assert.deepEqual(result.json(), { error });
    await context.app.close();
  }
});

test("message search route hides unexpected errors", async () => {
  const { app, interpreter } = appFor();
  interpreter.error = new Error("sensitive detail");
  const result = await app.inject({ method: "POST", url: "/internal/search/from-message", headers: { "x-internal-key": internalApiKey }, payload: { raw_text: "mensagem" } });
  assert.equal(result.statusCode, 500);
  assert.deepEqual(result.json(), { error: "internal_error" });
  assert.equal(result.body.includes("sensitive detail"), false);
  await app.close();
});
