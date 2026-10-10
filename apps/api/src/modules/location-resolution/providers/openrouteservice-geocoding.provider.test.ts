import assert from "node:assert/strict";
import test from "node:test";
import { OpenRouteServiceGeocodingProvider } from "./openrouteservice-geocoding.provider.js";
import { GeocodingProviderError } from "../location-resolution.types.js";

const config = { apiKey: "secret-key", baseUrl: "https://api.heigit.org/pelias/v1", confidenceThreshold: 0.85, ambiguityGap: 0.1 };
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
  assert.equal(provider.name, "openrouteservice");
  assert.equal(requestedUrl?.origin, "https://api.heigit.org");
  assert.equal(requestedUrl?.pathname, "/pelias/v1/search");
  assert.equal(requestedUrl?.searchParams.get("text"), "Sinop, MT");
  assert.equal(requestedUrl?.searchParams.get("boundary.country"), "BR");
  assert.equal(requestedUrl?.searchParams.get("layers"), "locality,localadmin");
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

test("reverseGeocode uses Authorization and encodes /pelias/v1/reverse query parameters", async () => {
  let requestedUrl: URL | undefined;
  let authorization: string | null = null;
  const provider = new OpenRouteServiceGeocodingProvider(config, async (url, init) => {
    requestedUrl = url instanceof URL ? url : new URL(String(url));
    authorization = new Headers(init?.headers).get("Authorization");
    return new Response(JSON.stringify(payload([feature()])), { status: 200 });
  });

  const result = await provider.reverseGeocode({
    latitude: -11.8548,
    longitude: -55.5089,
    country_code: "BR",
  });

  assert.equal(requestedUrl?.origin, "https://api.heigit.org");
  assert.equal(requestedUrl?.pathname, "/pelias/v1/reverse");
  assert.equal(requestedUrl?.searchParams.get("point.lat"), "-11.8548");
  assert.equal(requestedUrl?.searchParams.get("point.lon"), "-55.5089");
  assert.equal(requestedUrl?.searchParams.get("boundary.country"), "BR");
  assert.equal(requestedUrl?.searchParams.get("size"), "1");
  assert.equal(authorization, "secret-key");
  assert.ok(result);
  assert.equal(result.city, "Sinop");
  assert.equal(result.state, "MT");
  assert.equal(result.country_code, "BR");
});

test("reverseGeocode returns null on empty features", async () => {
  const provider = new OpenRouteServiceGeocodingProvider(config, async () => {
    return new Response(JSON.stringify(payload([])), { status: 200 });
  });
  const result = await provider.reverseGeocode({ latitude: -11.85, longitude: -55.50 });
  assert.equal(result, null);
});

test("reverseGeocode returns null on malformed payload", async () => {
  const provider = new OpenRouteServiceGeocodingProvider(config, async () => {
    return new Response(JSON.stringify({ not_features: 123 }), { status: 200 });
  });
  const result = await provider.reverseGeocode({ latitude: -11.85, longitude: -55.50 });
  assert.equal(result, null);
});

test("reverseGeocode returns null on network error", async () => {
  const provider = new OpenRouteServiceGeocodingProvider(config, async () => {
    throw new Error("network connection refused");
  });
  const result = await provider.reverseGeocode({ latitude: -11.85, longitude: -55.50 });
  assert.equal(result, null);
});

test("reverseGeocode returns null on 429 rate limit", async () => {
  const provider = new OpenRouteServiceGeocodingProvider(config, async () => {
    return new Response("", { status: 429 });
  });
  const result = await provider.reverseGeocode({ latitude: -11.85, longitude: -55.50 });
  assert.equal(result, null);
});

test("reverseGeocode returns null on 500 server error", async () => {
  const provider = new OpenRouteServiceGeocodingProvider(config, async () => {
    return new Response("", { status: 500 });
  });
  const result = await provider.reverseGeocode({ latitude: -11.85, longitude: -55.50 });
  assert.equal(result, null);
});

test("reverseGeocode metadata never replaces exact input coordinates in matching authority", async () => {
  const exactInputLat = -11.851234;
  const exactInputLng = -55.512345;
  // Feature returned has approximate/centroid coordinates [-55.5091, -11.8608]
  const provider = new OpenRouteServiceGeocodingProvider(config, async () => {
    return new Response(JSON.stringify(payload([feature()])), { status: 200 });
  });

  const revResult = await provider.reverseGeocode({ latitude: exactInputLat, longitude: exactInputLng });
  assert.ok(revResult);
  assert.equal(revResult.city, "Sinop");

  // In the matching flow, the domain keeps exactInputLat / exactInputLng, using revResult only for label/metadata
  const matchingCoordinates = {
    latitude: exactInputLat,
    longitude: exactInputLng,
    city: revResult.city ?? undefined,
    state: revResult.state ?? undefined,
    source: "whatsapp_native",
  };
  assert.equal(matchingCoordinates.latitude, exactInputLat);
  assert.equal(matchingCoordinates.longitude, exactInputLng);
  assert.notEqual(matchingCoordinates.latitude, revResult.latitude);
});
