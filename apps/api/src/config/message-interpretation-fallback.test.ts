import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MESSAGE_INTERPRETATION_FALLBACK_MODEL,
  DEFAULT_MESSAGE_INTERPRETATION_FALLBACK_TIMEOUT_MS,
  readMessageInterpretationFallbackConfig,
} from "./message-interpretation-fallback.js";

test("message interpretation fallback configuration is disabled by default", () => {
  assert.deepEqual(readMessageInterpretationFallbackConfig({}), {
    enabled: false,
    apiKey: undefined,
    model: DEFAULT_MESSAGE_INTERPRETATION_FALLBACK_MODEL,
    timeoutMs: DEFAULT_MESSAGE_INTERPRETATION_FALLBACK_TIMEOUT_MS,
  });
});

test("message interpretation fallback permits enabled startup without an API key", () => {
  assert.deepEqual(readMessageInterpretationFallbackConfig({
    MESSAGE_INTERPRETATION_FALLBACK_ENABLED: "TRUE",
    MESSAGE_INTERPRETATION_FALLBACK_MODEL: "configured-model",
    MESSAGE_INTERPRETATION_FALLBACK_TIMEOUT_MS: "2500",
  }), {
    enabled: true,
    apiKey: undefined,
    model: "configured-model",
    timeoutMs: 2500,
  });
});

test("message interpretation fallback configuration validates environment values", () => {
  for (const environment of [
    { MESSAGE_INTERPRETATION_FALLBACK_ENABLED: "yes" },
    { MESSAGE_INTERPRETATION_FALLBACK_MODEL: " " },
    { MESSAGE_INTERPRETATION_FALLBACK_TIMEOUT_MS: "0" },
    { MESSAGE_INTERPRETATION_FALLBACK_TIMEOUT_MS: "5.5" },
  ]) {
    assert.throws(
      () => readMessageInterpretationFallbackConfig(environment),
      /Invalid message interpretation fallback configuration/u,
    );
  }
});
