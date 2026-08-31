import assert from "node:assert/strict";
import test from "node:test";
import {
  messageSearchResponseSchema,
  type LocationResolutionResponse,
  type MatchingSearchResponse,
  type MessageInterpretationInput,
  type MessageInterpretationResponse,
  type SearchOrchestrationInput,
  type SearchOrchestrationResponse,
  type ServiceResolutionResponse,
} from "@contatocerto/shared";
import type { MessageInterpretationService } from "../message-interpretation/message-interpretation.types.js";
import type { SearchOrchestrationOutcome, SearchOrchestrationService } from "../search-orchestration/search-orchestration.types.js";
import { DeterministicMessageSearchService } from "./message-search.service.js";

const serviceId = "11111111-1111-4111-8111-111111111111";
const serviceResolved: ServiceResolutionResponse = {
  status: "resolved",
  normalized_text: "tomada",
  match: { service: { id: serviceId, name: "Eletricista", slug: "eletricista" }, method: "exact", matched_term: "tomada", confidence: 1 },
  candidates: [],
};
const serviceUnresolved: ServiceResolutionResponse = { status: "unresolved", normalized_text: "desconhecido", match: null, candidates: [] };
const serviceAmbiguous: ServiceResolutionResponse = { status: "ambiguous", normalized_text: "reparo", match: null, candidates: [serviceResolved.match!] };
const locationResolved: LocationResolutionResponse = {
  status: "resolved",
  query: "sinop, MT",
  country_code: "BR",
  match: { label: "Sinop", latitude: -11.862643, longitude: -55.486386, city: "Sinop", state: "MT", neighborhood: null, country_code: "BR", confidence: 1, layer: "locality" },
  candidates: [],
  provider: "fake-geocoder",
};
const locationUnresolved: LocationResolutionResponse = { status: "unresolved", query: "lugar", country_code: "BR", match: null, candidates: [], provider: "fake-geocoder" };
const locationAmbiguous: LocationResolutionResponse = { ...locationUnresolved, status: "ambiguous", candidates: [locationResolved.match!] };

const needsLocationInterpretation: MessageInterpretationResponse = {
  status: "needs_location",
  raw_text: "preciso de eletricista em sinop",
  service_text: "preciso de eletricista em sinop",
  location_text: null,
  country_code: "BR",
  interpretation: { service_strategy: "full_message", location_strategy: "none" },
};
const interpreted: MessageInterpretationResponse = {
  status: "interpreted",
  raw_text: "minha tomada queimou aqui em sinop",
  service_text: "minha tomada queimou aqui em sinop",
  location_text: "sinop",
  country_code: "BR",
  interpretation: { service_strategy: "full_message", location_strategy: "locative_phrase" },
};

function matchingResponse(matches: MatchingSearchResponse["matches"]): MatchingSearchResponse {
  return {
    search_request_id: "22222222-2222-4222-8222-222222222222",
    status: matches.length ? "matched" : "ready",
    service: serviceResolved.match!.service,
    location: { latitude: -11.862643, longitude: -55.486386, city: "Sinop", state: "MT", neighborhood: null },
    matches,
    meta: { count: matches.length, limit: 3, availability_freshness_minutes: 240 },
  };
}

const professionalMatch: MatchingSearchResponse["matches"][number] = {
  match_id: "33333333-3333-4333-8333-333333333333",
  rank_position: 1,
  distance_meters: 0,
  effective_available_now: true,
  professional: { id: "44444444-4444-4444-8444-444444444444", display_name: "Ricardo", slug: "ricardo", bio: null, profile_image_url: null, is_verified: false },
  service: { professional_service_id: "55555555-5555-4555-8555-555555555555", description: null, price_mode: "quote", price_from_cents: null, price_to_cents: null },
  service_area: { id: "66666666-6666-4666-8666-666666666666", label: "Sinop", city: "Sinop", state: "MT", radius_meters: 40_000 },
};

function needsService(reason: "unresolved" | "ambiguous"): SearchOrchestrationResponse {
  return {
    status: "needs_service",
    reason,
    service_resolution: reason === "unresolved" ? serviceUnresolved : serviceAmbiguous,
    location_resolution: null,
    matching: null,
  };
}

function needsLocation(reason: "unresolved" | "ambiguous"): SearchOrchestrationResponse {
  return {
    status: "needs_location",
    reason,
    service_resolution: serviceResolved,
    location_resolution: reason === "unresolved" ? locationUnresolved : locationAmbiguous,
    matching: null,
  };
}

const matched: SearchOrchestrationResponse = { status: "matched", reason: null, service_resolution: serviceResolved, location_resolution: locationResolved, matching: matchingResponse([professionalMatch]) };
const noMatches: SearchOrchestrationResponse = { status: "no_matches", reason: null, service_resolution: serviceResolved, location_resolution: locationResolved, matching: matchingResponse([]) };

class FakeMessageInterpretationService implements MessageInterpretationService {
  calls = 0;
  received: MessageInterpretationInput | undefined;
  constructor(public response: MessageInterpretationResponse) {}
  interpret(input: MessageInterpretationInput) {
    this.calls += 1;
    this.received = input;
    return this.response;
  }
}

class FakeSearchOrchestrationService implements SearchOrchestrationService {
  calls = 0;
  received: SearchOrchestrationInput | undefined;
  constructor(public outcome: SearchOrchestrationOutcome) {}
  async orchestrate(input: SearchOrchestrationInput) {
    this.calls += 1;
    this.received = input;
    return this.outcome;
  }
}

function createService(interpretation: MessageInterpretationResponse, outcome: SearchOrchestrationOutcome) {
  const interpreter = new FakeMessageInterpretationService(interpretation);
  const orchestrator = new FakeSearchOrchestrationService(outcome);
  return { interpreter, orchestrator, service: new DeterministicMessageSearchService(interpreter, orchestrator) };
}

const input = { raw_text: interpreted.raw_text, country_code: "BR", limit: 3 } as const;

test("message search stops at interpretation when an explicit location is missing", async () => {
  const context = createService(needsLocationInterpretation, { kind: "response", response: matched });
  const outcome = await context.service.search({ ...input, raw_text: needsLocationInterpretation.raw_text });
  assert.equal(context.interpreter.calls, 1);
  assert.deepEqual(context.interpreter.received, { raw_text: needsLocationInterpretation.raw_text, country_code: "BR" });
  assert.equal(context.orchestrator.calls, 0);
  assert.deepEqual(outcome, {
    kind: "response",
    response: {
      status: "needs_location",
      stage: "interpretation",
      reason: "missing_explicit_location",
      interpretation: needsLocationInterpretation,
      orchestration: null,
    },
  });
});

test("message search passes the interpreter slots unchanged to orchestration exactly once", async () => {
  const context = createService(interpreted, { kind: "response", response: needsService("unresolved") });
  await context.service.search({ ...input, limit: 7 });
  assert.equal(context.interpreter.calls, 1);
  assert.equal(context.orchestrator.calls, 1);
  assert.deepEqual(context.orchestrator.received, {
    raw_text: interpreted.raw_text,
    service_text: interpreted.service_text,
    location_text: interpreted.location_text,
    country_code: interpreted.country_code,
    limit: 7,
  });
});

test("message search maps every orchestration response to its exact public stage", async () => {
  for (const [orchestration, status, stage, reason] of [
    [needsService("unresolved"), "needs_service", "service_resolution", "unresolved"],
    [needsService("ambiguous"), "needs_service", "service_resolution", "ambiguous"],
    [needsLocation("unresolved"), "needs_location", "location_resolution", "unresolved"],
    [needsLocation("ambiguous"), "needs_location", "location_resolution", "ambiguous"],
    [matched, "matched", "matching", null],
    [noMatches, "no_matches", "matching", null],
  ] as const) {
    const context = createService(interpreted, { kind: "response", response: orchestration });
    const outcome = await context.service.search(input);
    assert.equal(outcome.kind, "response");
    if (outcome.kind === "response") {
      assert.equal(outcome.response.status, status);
      assert.equal(outcome.response.stage, stage);
      assert.equal(outcome.response.reason, reason);
      assert.deepEqual(outcome.response.interpretation, interpreted);
      assert.deepEqual(outcome.response.orchestration, orchestration);
      assert.equal(messageSearchResponseSchema.safeParse(outcome.response).success, true);
      const serialized = JSON.stringify(outcome.response);
      assert.equal(serialized.includes('"phone"'), false);
      assert.equal(serialized.includes('"email"'), false);
    }
  }
});

test("message search preserves service unavailable and rejects impossible contracts", async () => {
  const context = createService(interpreted, { kind: "service_unavailable" });
  assert.deepEqual(await context.service.search(input), { kind: "service_unavailable" });

  assert.equal(messageSearchResponseSchema.safeParse({
    status: "needs_location",
    stage: "interpretation",
    reason: "missing_explicit_location",
    interpretation: interpreted,
    orchestration: null,
  }).success, false);
  assert.equal(messageSearchResponseSchema.safeParse({
    status: "needs_service",
    stage: "service_resolution",
    reason: "unresolved",
    interpretation: interpreted,
    orchestration: needsService("ambiguous"),
  }).success, false);
});
