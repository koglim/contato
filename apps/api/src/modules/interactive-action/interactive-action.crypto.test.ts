import test from "node:test";
import assert from "node:assert/strict";
import {
  generateInteractiveActionToken,
  isValidInteractiveActionToken,
} from "./interactive-action.crypto.js";

test("generateInteractiveActionToken generates valid tokens with ia_ prefix and 48 hex chars (51 total)", () => {
  const token = generateInteractiveActionToken();
  assert.equal(typeof token, "string");
  assert.equal(token.startsWith("ia_"), true);
  assert.equal(token.length, 51);
  assert.equal(isValidInteractiveActionToken(token), true);
});

test("generateInteractiveActionToken produces high entropy unique tokens", () => {
  const tokens = new Set<string>();
  const count = 1000;
  for (let i = 0; i < count; i++) {
    tokens.add(generateInteractiveActionToken());
  }
  assert.equal(tokens.size, count);
});

test("isValidInteractiveActionToken validates proper token formatting strictly", () => {
  assert.equal(isValidInteractiveActionToken("ia_" + "a".repeat(48)), true);
  assert.equal(isValidInteractiveActionToken("ia_" + "0123456789abcdef".repeat(3)), true);

  // Invalid cases
  assert.equal(isValidInteractiveActionToken(""), false);
  assert.equal(isValidInteractiveActionToken(null as unknown as string), false);
  assert.equal(isValidInteractiveActionToken(undefined as unknown as string), false);
  assert.equal(isValidInteractiveActionToken(123 as unknown as string), false);
  assert.equal(isValidInteractiveActionToken("ia_" + "a".repeat(47)), false); // too short
  assert.equal(isValidInteractiveActionToken("ia_" + "a".repeat(49)), false); // too long
  assert.equal(isValidInteractiveActionToken("ib_" + "a".repeat(48)), false); // wrong prefix
  assert.equal(isValidInteractiveActionToken("ia_" + "g".repeat(48)), false); // non-hex character
  assert.equal(isValidInteractiveActionToken("ia_" + "A".repeat(48)), false); // uppercase not allowed
  assert.equal(isValidInteractiveActionToken(" ia_" + "a".repeat(48)), false); // leading whitespace
  assert.equal(isValidInteractiveActionToken("ia_" + "a".repeat(48) + " "), false); // trailing whitespace
});
