import assert from "node:assert/strict";
import test from "node:test";
import { INBOX_BACKOFF_SECONDS, INBOX_MAX_ATTEMPTS, inboxErrorCode, isInboxPermanent, liveInboxLeaseSql } from "./inbox-recovery.policy.js";

test("Inbox recovery has five bounded effective attempts and stable backoff", () => {
  assert.equal(INBOX_MAX_ATTEMPTS, 5);
  assert.deepEqual(INBOX_BACKOFF_SECONDS, [30, 60, 120, 240]);
});
test("Inbox error classification never persists arbitrary provider or user text", () => {
  assert.equal(inboxErrorCode("secret +5566999999999 raw message"), "internal_error");
  assert.equal(inboxErrorCode("geocoding_unavailable"), "geocoding_unavailable");
  assert.equal(inboxErrorCode("customer_phone_identity_collision"), "customer_phone_identity_collision");
  assert.equal(isInboxPermanent("persisted_proposal_invalid"), true);
  assert.equal(isInboxPermanent("customer_phone_identity_collision"), true);
  assert.equal(isInboxPermanent("internal_error"), false);
  assert.match(liveInboxLeaseSql, /clock_timestamp/);
});
