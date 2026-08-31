import assert from "node:assert/strict";
import test from "node:test";
import type { SearchOrchestrationInput, SearchOrchestrationResponse } from "@contatocerto/shared";
import { buildApp } from "../../app.js";
import { GeocodingProviderError } from "../location-resolution/location-resolution.types.js";
import type { SearchOrchestrationOutcome, SearchOrchestrationService } from "./search-orchestration.types.js";

const internalApiKey = "test-internal-key";
const response: SearchOrchestrationResponse = {
  status: "needs_service", reason: "unresolved",
  service_resolution: { status: "unresolved", normalized_text: "desconhecido", match: null, candidates: [] },
  location_resolution: null, matching: null,
};

class FakeSearchOrchestrationService implements SearchOrchestrationService {
  calls = 0;
  received: SearchOrchestrationInput | undefined;
  error: Error | undefined;
  outcome: SearchOrchestrationOutcome = { kind: "response", response };
  async orchestrate(input: SearchOrchestrationInput) {
    this.calls += 1;
    this.received = input;
    if (this.error) throw this.error;
    return this.outcome;
  }
}

function appFor(service = new FakeSearchOrchestrationService()) {
  return { app: buildApp({ internalApiKey, searchOrchestrationService: service }), service };
}

const validBody = { raw_text: "Preciso de um eletricista em Sinop", service_text: "eletricista", location_text: "Sinop, MT" };

test("search orchestration requires the internal key and validates bounded input", async () => {
  const { app, service } = appFor();
  assert.equal((await app.inject({ method: "POST", url: "/internal/search/orchestrate", payload: validBody })).statusCode, 401);
  for (const payload of [{}, { ...validBody, raw_text: " " }, { ...validBody, service_text: " " }, { ...validBody, location_text: " " }, { ...validBody, limit: 11 }]) {
    assert.equal((await app.inject({ method: "POST", url: "/internal/search/orchestrate", headers: { "x-internal-key": internalApiKey }, payload })).statusCode, 400);
  }
  assert.equal(service.calls, 0);
  await app.close();
});

test("search orchestration normalizes defaults and returns controlled responses", async () => {
  const { app, service } = appFor();
  const result = await app.inject({ method: "POST", url: "/internal/search/orchestrate", headers: { "x-internal-key": internalApiKey }, payload: { ...validBody, country_code: "br" } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(service.received, { ...validBody, country_code: "BR", limit: 3 });
  service.outcome = { kind: "service_unavailable" };
  assert.deepEqual((await app.inject({ method: "POST", url: "/internal/search/orchestrate", headers: { "x-internal-key": internalApiKey }, payload: validBody })).json(), { error: "service_unavailable" });
  await app.close();
});

test("search orchestration preserves geocoding failures without exposing internals", async () => {
  for (const [kind, status, error] of [
    ["unavailable", 503, "geocoding_unavailable"],
    ["rate_limited", 429, "geocoding_rate_limited"],
    ["provider_error", 502, "geocoding_provider_error"],
  ] as const) {
    const { app, service } = appFor();
    service.error = new GeocodingProviderError(kind);
    const result = await app.inject({ method: "POST", url: "/internal/search/orchestrate", headers: { "x-internal-key": internalApiKey }, payload: validBody });
    assert.equal(result.statusCode, status);
    assert.deepEqual(result.json(), { error });
    await app.close();
  }
});
