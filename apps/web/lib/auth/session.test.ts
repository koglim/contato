import assert from "node:assert/strict";
import test from "node:test";
import { createDashboardSession, hasMatchingDemoPassword, isDashboardSessionValid } from "./session";

const secret = "test-session-secret";
const now = 1_700_000_000_000;

test("accepts a valid signed dashboard session", () => {
  const token = createDashboardSession(secret, now, 60);
  assert.equal(isDashboardSessionValid(token, secret, now), true);
});

test("rejects a session with an invalid signature or altered payload", () => {
  const token = createDashboardSession(secret, now, 60);
  assert.equal(isDashboardSessionValid("granted", secret, now), false);
  assert.equal(isDashboardSessionValid(`${token}x`, secret, now), false);
  assert.equal(isDashboardSessionValid("ZXhwOjE5MDAwMDAwMDA.invalid", secret, now), false);
});

test("rejects an expired dashboard session", () => {
  const token = createDashboardSession(secret, now, 1);
  assert.equal(isDashboardSessionValid(token, secret, now + 1_000), false);
});

test("compares the temporary access password without exposing it", () => {
  assert.equal(hasMatchingDemoPassword("correct-password", "correct-password"), true);
  assert.equal(hasMatchingDemoPassword("wrong-password", "correct-password"), false);
});
