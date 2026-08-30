import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SERVICE_RESOLUTION_FUZZY_AMBIGUITY_GAP,
  DEFAULT_SERVICE_RESOLUTION_FUZZY_THRESHOLD,
  readServiceResolutionConfig,
} from "./service-resolution.js";

test("service resolution configuration uses safe defaults", () => {
  assert.deepEqual(readServiceResolutionConfig({}), {
    fuzzyThreshold: DEFAULT_SERVICE_RESOLUTION_FUZZY_THRESHOLD,
    fuzzyAmbiguityGap: DEFAULT_SERVICE_RESOLUTION_FUZZY_AMBIGUITY_GAP,
  });
});

test("service resolution configuration accepts valid environment overrides", () => {
  assert.deepEqual(readServiceResolutionConfig({
    SERVICE_RESOLUTION_FUZZY_THRESHOLD: "0.6",
    SERVICE_RESOLUTION_FUZZY_AMBIGUITY_GAP: "0.2",
  }), { fuzzyThreshold: 0.6, fuzzyAmbiguityGap: 0.2 });
});

test("service resolution configuration rejects invalid fuzzy calibration", () => {
  assert.throws(() => readServiceResolutionConfig({ SERVICE_RESOLUTION_FUZZY_THRESHOLD: "banana" }), /SERVICE_RESOLUTION_FUZZY_THRESHOLD/);
  assert.throws(() => readServiceResolutionConfig({ SERVICE_RESOLUTION_FUZZY_THRESHOLD: "-1" }), /SERVICE_RESOLUTION_FUZZY_THRESHOLD/);
  assert.throws(() => readServiceResolutionConfig({ SERVICE_RESOLUTION_FUZZY_THRESHOLD: "1.5" }), /SERVICE_RESOLUTION_FUZZY_THRESHOLD/);
  assert.throws(() => readServiceResolutionConfig({ SERVICE_RESOLUTION_FUZZY_AMBIGUITY_GAP: "-0.1" }), /SERVICE_RESOLUTION_FUZZY_AMBIGUITY_GAP/);
  assert.throws(() => readServiceResolutionConfig({ SERVICE_RESOLUTION_FUZZY_AMBIGUITY_GAP: "2" }), /SERVICE_RESOLUTION_FUZZY_AMBIGUITY_GAP/);
});
