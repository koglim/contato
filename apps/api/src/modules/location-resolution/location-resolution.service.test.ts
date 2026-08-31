import assert from "node:assert/strict";
import test from "node:test";
import type { LocationResolutionCandidate } from "@contatocerto/shared";
import { DeterministicLocationResolutionService } from "./location-resolution.service.js";
import type { GeocodingProvider } from "./location-resolution.types.js";

const input = { query: "Sinop, MT", country_code: "BR", limit: 5 } as const;
function candidate(confidence: number | null, label = "Sinop") : LocationResolutionCandidate {
  return { label, latitude: -11.8608, longitude: -55.5091, city: "Sinop", state: "MT", country_code: "BR", neighborhood: null, confidence, layer: "locality" };
}
class FakeProvider implements GeocodingProvider {
  readonly name = "fake-geocoder";
  received: unknown;
  constructor(private readonly results: LocationResolutionCandidate[]) {}
  async geocode(value: typeof input) { this.received = value; return this.results; }
}
function resolve(results: LocationResolutionCandidate[], config = { confidenceThreshold: 0.85, ambiguityGap: 0.1 }) {
  const provider = new FakeProvider(results);
  return { provider, service: new DeterministicLocationResolutionService(provider, { apiKey: undefined, baseUrl: "https://api.heigit.org/pelias/v1", ...config }) };
}

test("location resolution preserves provider order and applies confidence decisions", async () => {
  const resolved = resolve([candidate(0.9)]);
  const result = await resolved.service.resolve(input);
  assert.equal(result.status, "resolved");
  assert.equal(result.provider, "fake-geocoder");
  assert.equal(result.match?.label, "Sinop");
  assert.deepEqual(resolved.provider.received, input);
  assert.deepEqual((await resolve([]).service.resolve(input)).status, "unresolved");
  assert.equal((await resolve([candidate(0.84)]).service.resolve(input)).status, "unresolved");
  assert.equal((await resolve([candidate(null)]).service.resolve(input)).status, "unresolved");
});

test("location resolution marks close candidates ambiguous and retains the input limit", async () => {
  const ambiguous = await resolve([candidate(0.9, "Sinop"), candidate(0.82, "Sinop bairro")]).service.resolve(input);
  const resolved = await resolve([candidate(0.9), candidate(0.7)]).service.resolve(input);
  const many = await resolve([candidate(0.9), candidate(0.85), candidate(0.83), candidate(0.8), candidate(0.79), candidate(0.78)]).service.resolve({ ...input, limit: 2 });
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.candidates[0].label, "Sinop");
  assert.equal(resolved.status, "resolved");
  assert.equal(many.status, "ambiguous");
  assert.equal(many.candidates.length, 2);
});
