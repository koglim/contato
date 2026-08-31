import assert from "node:assert/strict";
import test from "node:test";
import { OpenRouteServiceGeocodingProvider } from "./openrouteservice-geocoding.provider.js";
import { GeocodingProviderError } from "../location-resolution.types.js";

const config = { apiKey: "secret-key", baseUrl: "https://api.heigit.org", confidenceThreshold: 0.85, ambiguityGap: 0.1 };
const input = { query: "Sinop, MT", country_code: "BR", limit: 5 } as const;

function payload(features: unknown[]) {
  return { features };
}

function feature(overrides: Record<string, unknown> = {}) {
  return {
    geometry: { coordinates: [-55.5091, -11.8608] },
    properties: { label: "Sinop, Mato Grosso, Brasil", locality: "Sinop", region_a: "MT", country_a: "BR", confidence: 1, layer: "locality", ...overrides },
  };
}

test("geocoding provider uses Authorization and encodes the documented query parameters", async () => {
  let requestedUrl: URL | undefined;
  let authorization: string | null = null;
  const provider = new OpenRouteServiceGeocodingProvider(config, async (url, init) => {
    requestedUrl = url instanceof URL ? url : new URL(String(url));
    authorization = new Headers(init?.headers).get("Authorization");
    return new Response(JSON.stringify(payload([feature(), feature()])), { status: 200 });
  });
  const results = await provider.geocode(input);
  assert.equal(requestedUrl?.origin, "https://api.heigit.org");
  assert.equal(requestedUrl?.pathname, "/geocode/search");
  assert.equal(requestedUrl?.searchParams.get("text"), "Sinop, MT");
  assert.equal(requestedUrl?.searchParams.get("boundary.country"), "BR");
  assert.equal(requestedUrl?.searchParams.get("size"), "5");
  assert.equal(requestedUrl?.search.includes("secret-key"), false);
  assert.equal(authorization, "secret-key");
  assert.equal(results.length, 1);
  assert.deepEqual([results[0].longitude, results[0].latitude], [-55.5091, -11.8608]);
  assert.equal(results[0].neighborhood, null);
});

test("geocoding provider handles upstream errors and malformed payloads safely", async () => {
  const withResponse = (response: Response) => new OpenRouteServiceGeocodingProvider(config, async () => response);
  await assert.rejects(() => withResponse(new Response("", { status: 429 })).geocode(input), (error: unknown) => error instanceof GeocodingProviderError && error.kind === "rate_limited");
  await assert.rejects(() => withResponse(new Response("", { status: 500 })).geocode(input), (error: unknown) => error instanceof GeocodingProviderError && error.kind === "provider_error");
  await assert.rejects(() => withResponse(new Response(JSON.stringify({ nope: [] }), { status: 200 })).geocode(input), (error: unknown) => error instanceof GeocodingProviderError && error.kind === "provider_error");
  const unavailable = new OpenRouteServiceGeocodingProvider(config, async () => { throw new Error("network failed"); });
  await assert.rejects(() => unavailable.geocode(input), (error: unknown) => error instanceof GeocodingProviderError && error.kind === "unavailable");
});

test("geocoding provider requires a server-side API key only when initialized", () => {
  assert.throws(() => new OpenRouteServiceGeocodingProvider({ ...config, apiKey: undefined }), /OPENROUTESERVICE_API_KEY/);
});
