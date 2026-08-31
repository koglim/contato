import assert from "node:assert/strict";
import test from "node:test";
import type {
  LocationResolutionResponse,
  MatchingSearchInput,
  MatchingSearchResponse,
  ServiceResolutionResponse,
} from "@contatocerto/shared";
import type { LocationResolutionService } from "../location-resolution/location-resolution.types.js";
import type { MatchingRepository, MatchingSearchOutcome } from "../matching/matching.types.js";
import type { ServiceResolutionRepository } from "../service-resolution/service-resolution.types.js";
import { DeterministicSearchOrchestrator } from "./search-orchestration.service.js";

const serviceId = "11111111-1111-4111-8111-111111111111";
const serviceResolved: ServiceResolutionResponse = { status: "resolved", normalized_text: "eletricista", match: { service: { id: serviceId, name: "Eletricista", slug: "eletricista" }, method: "exact", matched_term: "eletricista", confidence: 1 }, candidates: [] };
const serviceUnresolved: ServiceResolutionResponse = { status: "unresolved", normalized_text: "desconhecido", match: null, candidates: [] };
const serviceAmbiguous: ServiceResolutionResponse = { status: "ambiguous", normalized_text: "reparo", match: null, candidates: [serviceResolved.match!] };
const locationResolved: LocationResolutionResponse = { status: "resolved", query: "Sinop, MT", country_code: "BR", match: { label: "Sinop", latitude: -11.862643, longitude: -55.486386, city: "Sinop", state: "MT", neighborhood: null, country_code: "BR", confidence: 1, layer: "locality" }, candidates: [], provider: "fake-geocoder" };
const locationUnresolved: LocationResolutionResponse = { status: "unresolved", query: "lugar", country_code: "BR", match: null, candidates: [], provider: "fake-geocoder" };
const locationAmbiguous: LocationResolutionResponse = { ...locationUnresolved, status: "ambiguous", candidates: [{ ...locationResolved.match! }] };

function matchingResponse(matches: MatchingSearchResponse["matches"]): MatchingSearchResponse {
  return {
    search_request_id: "22222222-2222-4222-8222-222222222222", status: matches.length ? "matched" : "ready",
    service: serviceResolved.match!.service,
    location: { latitude: -11.862643, longitude: -55.486386, city: "Sinop", state: "MT", neighborhood: null },
    matches, meta: { count: matches.length, limit: 3, availability_freshness_minutes: 240 },
  };
}

class FakeServiceResolutionRepository implements ServiceResolutionRepository {
  calls = 0;
  constructor(private readonly response: ServiceResolutionResponse, private readonly order: string[]) {}
  async resolve() { this.calls += 1; this.order.push("service"); return this.response; }
}

class FakeLocationResolutionService implements LocationResolutionService {
  calls = 0;
  received: unknown;
  constructor(private readonly response: LocationResolutionResponse, private readonly order: string[]) {}
  async resolve(input: unknown) { this.calls += 1; this.received = input; this.order.push("location"); return this.response; }
}

class FakeMatchingRepository implements MatchingRepository {
  calls = 0;
  received: MatchingSearchInput | undefined;
  constructor(private readonly outcome: MatchingSearchOutcome, private readonly order: string[]) {}
  async search(input: MatchingSearchInput) { this.calls += 1; this.received = input; this.order.push("matching"); return this.outcome; }
}

function createOrchestrator(service: ServiceResolutionResponse, location: LocationResolutionResponse, outcome: MatchingSearchOutcome) {
  const order: string[] = [];
  const serviceRepository = new FakeServiceResolutionRepository(service, order);
  const locationService = new FakeLocationResolutionService(location, order);
  const matchingRepository = new FakeMatchingRepository(outcome, order);
  return { order, serviceRepository, locationService, matchingRepository, service: new DeterministicSearchOrchestrator(serviceRepository, locationService, matchingRepository) };
}

const input = { raw_text: "Preciso de um eletricista em Sinop", service_text: "eletricista", location_text: "Sinop, MT", country_code: "BR", limit: 3 } as const;

test("search orchestration short-circuits unresolved and ambiguous services", async () => {
  for (const response of [serviceUnresolved, serviceAmbiguous]) {
    const orchestrator = createOrchestrator(response, locationResolved, { kind: "success", response: matchingResponse([]) });
    const result = await orchestrator.service.orchestrate(input);
    assert.equal(result.kind, "response");
    if (result.kind === "response") {
      assert.equal(result.response.status, "needs_service");
      assert.equal(result.response.reason, response.status === "ambiguous" ? "ambiguous" : "unresolved");
    }
    assert.deepEqual(orchestrator.order, ["service"]);
    assert.equal(orchestrator.locationService.calls, 0);
    assert.equal(orchestrator.matchingRepository.calls, 0);
  }
});

test("search orchestration short-circuits unresolved and ambiguous locations", async () => {
  for (const response of [locationUnresolved, locationAmbiguous]) {
    const orchestrator = createOrchestrator(serviceResolved, response, { kind: "success", response: matchingResponse([]) });
    const result = await orchestrator.service.orchestrate(input);
    assert.equal(result.kind, "response");
    if (result.kind === "response") {
      assert.equal(result.response.status, "needs_location");
      assert.equal(result.response.reason, response.status === "ambiguous" ? "ambiguous" : "unresolved");
    }
    assert.deepEqual(orchestrator.order, ["service", "location"]);
    assert.deepEqual(orchestrator.locationService.received, { query: "Sinop, MT", country_code: "BR", limit: 5 });
    assert.equal(orchestrator.matchingRepository.calls, 0);
  }
});

test("search orchestration passes the original text and resolved location to matching once", async () => {
  const professionalMatch = {
    match_id: "33333333-3333-4333-8333-333333333333", rank_position: 1, distance_meters: 0, effective_available_now: true,
    professional: { id: "44444444-4444-4444-8444-444444444444", display_name: "Ricardo", slug: "ricardo", bio: null, profile_image_url: null, is_verified: false },
    service: { professional_service_id: "55555555-5555-4555-8555-555555555555", description: null, price_mode: "quote" as const, price_from_cents: null, price_to_cents: null },
    service_area: { id: "66666666-6666-4666-8666-666666666666", label: "Sinop", city: "Sinop", state: "MT", radius_meters: 40_000 },
  };
  const matched = createOrchestrator(serviceResolved, locationResolved, { kind: "success", response: matchingResponse([professionalMatch]) });
  const result = await matched.service.orchestrate({ ...input, limit: 7 });
  assert.equal(result.kind, "response");
  if (result.kind === "response") assert.equal(result.response.status, "matched");
  assert.deepEqual(matched.order, ["service", "location", "matching"]);
  assert.deepEqual(matched.matchingRepository.received, {
    raw_text: input.raw_text, service_id: serviceId, latitude: -11.862643, longitude: -55.486386,
    city: "Sinop", state: "MT", neighborhood: null, limit: 7,
  });
  const noMatches = createOrchestrator(serviceResolved, locationResolved, { kind: "success", response: matchingResponse([]) });
  const noMatchesResult = await noMatches.service.orchestrate(input);
  assert.equal(noMatchesResult.kind, "response");
  if (noMatchesResult.kind === "response") assert.equal(noMatchesResult.response.status, "no_matches");
  const unavailable = createOrchestrator(serviceResolved, locationResolved, { kind: "service_inactive" });
  assert.deepEqual(await unavailable.service.orchestrate(input), { kind: "service_unavailable" });
});
