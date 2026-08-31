import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LOCATION_RESOLUTION_AMBIGUITY_GAP,
  DEFAULT_LOCATION_RESOLUTION_CONFIDENCE_THRESHOLD,
  DEFAULT_OPENROUTESERVICE_BASE_URL,
  readLocationResolutionConfig,
} from "./location-resolution.js";

test("location resolution configuration uses documented defaults", () => {
  assert.deepEqual(readLocationResolutionConfig({}), {
    apiKey: undefined,
    baseUrl: DEFAULT_OPENROUTESERVICE_BASE_URL,
    confidenceThreshold: DEFAULT_LOCATION_RESOLUTION_CONFIDENCE_THRESHOLD,
    ambiguityGap: DEFAULT_LOCATION_RESOLUTION_AMBIGUITY_GAP,
  });
});

test("location resolution configuration validates overrides", () => {
  assert.deepEqual(readLocationResolutionConfig({
    OPENROUTESERVICE_API_KEY: "key",
    OPENROUTESERVICE_BASE_URL: "https://example.test",
    LOCATION_RESOLUTION_CONFIDENCE_THRESHOLD: "0.9",
    LOCATION_RESOLUTION_AMBIGUITY_GAP: "0.2",
  }), { apiKey: "key", baseUrl: "https://example.test", confidenceThreshold: 0.9, ambiguityGap: 0.2 });
  for (const environment of [
    { LOCATION_RESOLUTION_CONFIDENCE_THRESHOLD: "banana" },
    { LOCATION_RESOLUTION_CONFIDENCE_THRESHOLD: "2" },
    { LOCATION_RESOLUTION_AMBIGUITY_GAP: "-1" },
    { OPENROUTESERVICE_BASE_URL: "not a url" },
  ]) assert.throws(() => readLocationResolutionConfig(environment), /Invalid location resolution configuration/);
});
