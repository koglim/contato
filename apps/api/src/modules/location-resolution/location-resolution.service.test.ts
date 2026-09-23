import assert from "node:assert/strict";
import test from "node:test";
import type { LocationResolutionCandidate, LocationResolutionInput } from "@contatocerto/shared";
import { DeterministicLocationResolutionService } from "./location-resolution.service.js";
import type { GeocodingProvider, LocationResolutionDiagnostic } from "./location-resolution.types.js";

function candidate(overrides: Partial<LocationResolutionCandidate> = {}): LocationResolutionCandidate {
  return {
    label: "Sinop, MT, Brasil", latitude: -11.8608, longitude: -55.5091, city: "Sinop", state: "MT",
    country_code: "BR", neighborhood: null, confidence: 0.9, layer: "locality", ...overrides,
  };
}

class FakeProvider implements GeocodingProvider {
  readonly name = "fake-geocoder";
  received: LocationResolutionInput | undefined;
  constructor(private readonly results: LocationResolutionCandidate[]) {}
  async geocode(value: Pick<LocationResolutionInput, "query" | "country_code" | "limit">) { this.received = value; return this.results; }
}

function resolve(
  results: LocationResolutionCandidate[],
  query = "Cidade de teste",
  config = { confidenceThreshold: 0.85, ambiguityGap: 0.1 },
) {
  const provider = new FakeProvider(results);
  const diagnostics: LocationResolutionDiagnostic[] = [];
  const service = new DeterministicLocationResolutionService(
    provider,
    { apiKey: undefined, baseUrl: "https://api.heigit.org/pelias/v1", ...config },
    diagnostic => diagnostics.push(diagnostic),
  );
  return { provider, service, diagnostics, input: { query, country_code: "BR", limit: 5 } as const };
}

test("location resolution resolves Sinop and preserves provider identity and request", async () => {
  const current = resolve([candidate()]);
  const result = await current.service.resolve(current.input);
  assert.equal(result.status, "resolved");
  assert.equal(result.provider, "fake-geocoder");
  assert.equal(result.match?.city, "Sinop");
  assert.deepEqual(current.provider.received, current.input);
  assert.deepEqual(current.diagnostics, [{
    status: "resolved", reason: "resolved", resolution_source: "pelias", state: "MT",
    relevantCandidateCount: 1, collapsedCandidateCount: 0, confidenceGap: null,
    top: { city: "Sinop", state: "MT", confidence: 0.9, layer: "locality" }, second: null,
  }]);
});

test("IBGE resolves the unique official municipality without calling Pelias and keeps one record's coordinates", async () => {
  for (const query of ["Cuiabá", "CUIABA", "cuiaba", "Cuiabá, MT"]) {
    const current = resolve([], query);
    const result = await current.service.resolve(current.input);
    assert.equal(result.status, "resolved");
    assert.equal(result.resolution_source, "ibge_municipality");
    assert.equal(result.provider, "ibge");
    assert.deepEqual(result.match, {
      label: "Cuiabá, MT, Brasil", latitude: -15.56760025024414, longitude: -56.07500076293945,
      city: "Cuiabá", state: "MT", country_code: "BR", neighborhood: null, confidence: 1,
      layer: "locality", municipality_code: "5103403",
    });
    assert.equal(current.provider.received, undefined);
    assert.deepEqual(current.diagnostics[0], {
      status: "resolved", reason: "resolved", resolution_source: "ibge_municipality",
      municipality_code: "5103403", state: "MT", relevantCandidateCount: 1,
      collapsedCandidateCount: 0, confidenceGap: null,
      top: { city: "Cuiabá", state: "MT", confidence: 1, layer: "locality" }, second: null,
    });
  }
});

test("IBGE resolves explicit UF and unique Sinop queries to their official municipality record", async () => {
  for (const query of ["Sinop", "Sinop, MT"]) {
    const current = resolve([], query);
    const result = await current.service.resolve(current.input);
    assert.equal(result.status, "resolved");
    assert.equal(result.resolution_source, "ibge_municipality");
    assert.equal(result.match?.municipality_code, "5107909");
    assert.equal(result.match?.state, "MT");
    assert.equal(result.match?.latitude, -11.8572998046875);
    assert.equal(result.match?.longitude, -55.50830078125);
    assert.equal(current.provider.received, undefined);
  }
});

test("duplicate official municipality names stay ambiguous without UF and resolve with matching UF", async () => {
  const ambiguous = resolve([], "Bonito");
  const result = await ambiguous.service.resolve(ambiguous.input);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.resolution_source, "ibge_municipality");
  assert.equal(result.ambiguity_count, 4);
  assert.deepEqual(new Set(result.candidates.map((item) => item.state)), new Set(["BA", "MS", "PA", "PE"]));
  assert.equal(ambiguous.provider.received, undefined);

  const explicit = resolve([], "Bonito, MS");
  const stateResult = await explicit.service.resolve(explicit.input);
  assert.equal(stateResult.status, "resolved");
  assert.equal(stateResult.match?.state, "MS");
  assert.equal(stateResult.match?.municipality_code, "5002209");
  assert.equal(explicit.provider.received, undefined);
});

test("an explicit UF mismatch and a name absent from the index preserve the Pelias fallback", async () => {
  const mismatchedUf = resolve([
    candidate({ city: "Cuiabá", state: "AM", latitude: -3.1, longitude: -60.0, confidence: 0.9 }),
    candidate({ city: "Cuiabá", state: "MT", confidence: 0.99 }),
  ], "Cuiabá, AM");
  const mismatchResult = await mismatchedUf.service.resolve(mismatchedUf.input);
  assert.equal(mismatchResult.status, "resolved");
  assert.equal(mismatchResult.resolution_source, "pelias");
  assert.equal(mismatchResult.match?.state, "AM");
  assert.equal(mismatchedUf.provider.received?.query, "Cuiabá, AM");

  const missing = resolve([candidate({ city: "Vila Teste", state: "MT", confidence: 0.9 })], "Vila Teste");
  const missingResult = await missing.service.resolve(missing.input);
  assert.equal(missingResult.status, "resolved");
  assert.equal(missingResult.resolution_source, "pelias");
  assert.equal(missingResult.match?.city, "Vila Teste");
  assert.equal(missing.provider.received?.query, "Vila Teste");
});

test("equivalent Cuiabá locality and localadmin candidates collapse to one resolved city", async () => {
  const current = resolve([
    candidate({ label: "Cuiabá, Mato Grosso, Brasil", city: "Cuiabá", state: "MT", latitude: -15.601, longitude: -56.097, confidence: 0.91 }),
    candidate({ label: "Cuiabá, Mato Grosso, Brasil", city: "CUIABA", state: "Mato Grosso", latitude: -15.62, longitude: -56.11, confidence: 0.89, layer: "localadmin" }),
  ], "Localidade de teste");
  const result = await current.service.resolve(current.input);
  assert.equal(result.status, "resolved");
  assert.equal(result.match?.city, "Cuiabá");
  assert.equal(result.match?.layer, "locality");
  assert.deepEqual(current.diagnostics.map(({ reason, collapsedCandidateCount }) => ({ reason, collapsedCandidateCount })), [
    { reason: "equivalent_candidates_collapsed", collapsedCandidateCount: 1 },
  ]);
});

test("an above-threshold locality remains the representative despite higher localadmin confidence", async () => {
  const locality = candidate({ label: "Cuiabá locality", city: "Cuiabá", state: "MT", latitude: -15.601, longitude: -56.097, confidence: 0.89, layer: "locality" });
  const localadmin = candidate({ label: "Cuiabá localadmin", city: "Cuiabá", state: "MT", latitude: -15.673, longitude: -56.097, confidence: 0.93, layer: "localadmin" });
  const current = resolve([locality, localadmin], "Localidade de teste");
  const result = await current.service.resolve(current.input);
  assert.equal(result.status, "resolved");
  assert.deepEqual(result.match, locality);
});

test("a below-threshold locality does not displace a reliable equivalent localadmin", async () => {
  const locality = candidate({ label: "Cuiabá locality", city: "Cuiabá", state: "MT", latitude: -15.601, longitude: -56.097, confidence: 0.8, layer: "locality" });
  const localadmin = candidate({ label: "Cuiabá localadmin", city: "Cuiabá", state: "MT", latitude: -15.673, longitude: -56.097, confidence: 0.92, layer: "localadmin" });
  const current = resolve([locality, localadmin], "Localidade de teste");
  const result = await current.service.resolve(current.input);
  assert.equal(result.status, "resolved");
  assert.deepEqual(result.match, localadmin);
});

test("an explicit Brazilian UF removes incompatible cities before confidence comparison", async () => {
  const current = resolve([
    candidate({ city: "Cuiabá", state: "GO", confidence: 0.99 }),
    candidate({ city: "Cuiabá", state: "MT", latitude: -15.601, longitude: -56.097, confidence: 0.87 }),
  ], "Localidade de teste, MT");
  const result = await current.service.resolve(current.input);
  assert.equal(result.status, "resolved");
  assert.equal(result.match?.state, "MT");
});

test("same city names in different states remain ambiguous without an explicit UF", async () => {
  const current = resolve([
    candidate({ city: "Santa Rita", state: "MT", confidence: 0.91 }),
    candidate({ label: "Santa Rita, PB, Brasil", city: "Santa Rita", state: "PB", latitude: -7.1, longitude: -34.98, confidence: 0.88 }),
  ], "Localidade de teste");
  assert.equal((await current.service.resolve(current.input)).status, "ambiguous");
  assert.equal(current.diagnostics[0]?.reason, "competing_places");
});

test("same city names with city-level centroids farther than the equivalence radius remain distinct", async () => {
  const current = resolve([
    candidate({ city: "Santa Rita", state: "MT", confidence: 0.91 }),
    candidate({ label: "Santa Rita administrative area", city: "Santa Rita", state: "MT", latitude: -11.65, longitude: -55.5091, confidence: 0.88, layer: "localadmin" }),
  ], "Localidade de teste");
  assert.equal((await current.service.resolve(current.input)).status, "ambiguous");
  assert.equal(current.diagnostics[0]?.collapsedCandidateCount, 0);
});

test("a nonexistent city remains unresolved with no candidates", async () => {
  const current = resolve([], "Cidade Inexistente");
  assert.equal((await current.service.resolve(current.input)).status, "unresolved");
  assert.equal(current.diagnostics[0]?.reason, "no_candidates");
});

test("a city candidate below the configured confidence threshold remains unresolved", async () => {
  const current = resolve([candidate({ confidence: 0.84 })]);
  assert.equal((await current.service.resolve(current.input)).status, "unresolved");
  assert.equal(current.diagnostics[0]?.reason, "below_threshold");
});

test("two distinct city candidates with close confidence remain ambiguous", async () => {
  const current = resolve([
    candidate({ city: "Sinop", state: "MT", confidence: 0.9 }),
    candidate({ label: "Sinop, SP, Brasil", city: "Sinop", state: "SP", latitude: -23.5, longitude: -46.6, confidence: 0.82 }),
  ]);
  assert.equal((await current.service.resolve(current.input)).status, "ambiguous");
});

test("neighbourhoods and venues with a city-like name do not compete with a clear city", async () => {
  const current = resolve([
    candidate({ label: "Sinop, Mato Grosso, Brasil", confidence: 0.88 }),
    candidate({ label: "Sinop venue", city: "Sinop", confidence: 0.99, layer: "venue" }),
    candidate({ label: "Sinop neighbourhood", city: "Sinop", confidence: 0.98, layer: "neighbourhood" }),
  ]);
  const result = await current.service.resolve(current.input);
  assert.equal(result.status, "resolved");
  assert.equal(result.match?.layer, "locality");
});

test("location diagnostics omit coordinates and report top candidates and confidence gap", async () => {
  const current = resolve([
    candidate({ city: "Sinop", state: "MT", confidence: 0.9 }),
    candidate({ label: "Sinop, SP, Brasil", city: "Sinop", state: "SP", latitude: -23.5, longitude: -46.6, confidence: 0.84 }),
  ]);
  await current.service.resolve(current.input);
  assert.deepEqual(current.diagnostics[0], {
    status: "ambiguous", reason: "competing_places", resolution_source: "pelias", relevantCandidateCount: 2, collapsedCandidateCount: 0,
    confidenceGap: 0.06,
    top: { city: "Sinop", state: "MT", confidence: 0.9, layer: "locality" },
    second: { city: "Sinop", state: "SP", confidence: 0.84, layer: "locality" },
  });
  assert.equal(JSON.stringify(current.diagnostics).includes("latitude"), false);
  assert.equal(JSON.stringify(current.diagnostics).includes("longitude"), false);
});
