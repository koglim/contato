import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SEARCH_CONVERSATION_PROCESSING_LEASE_SECONDS,
  DEFAULT_SEARCH_CONVERSATION_TTL_MINUTES,
  readSearchConversationConfig,
} from "./search-conversation.js";

test("search conversation configuration uses 30 minute TTL and 60 second processing lease defaults", () => {
  assert.deepEqual(readSearchConversationConfig({}), {
    ttlMinutes: DEFAULT_SEARCH_CONVERSATION_TTL_MINUTES,
    processingLeaseSeconds: DEFAULT_SEARCH_CONVERSATION_PROCESSING_LEASE_SECONDS,
  });
});

test("search conversation configuration accepts only positive integer TTL values", () => {
  assert.equal(readSearchConversationConfig({ SEARCH_CONVERSATION_TTL_MINUTES: "45" }).ttlMinutes, 45);
  for (const value of ["0", "-1", "1.5", "invalid"]) {
    assert.throws(
      () => readSearchConversationConfig({ SEARCH_CONVERSATION_TTL_MINUTES: value }),
      /Invalid search conversation configuration/u,
    );
  }
});

test("search conversation configuration accepts only positive integer processing lease values", () => {
  assert.equal(
    readSearchConversationConfig({ SEARCH_CONVERSATION_PROCESSING_LEASE_SECONDS: "90" }).processingLeaseSeconds,
    90,
  );
  for (const value of ["0", "-1", "1.5", "invalid"]) {
    assert.throws(
      () => readSearchConversationConfig({ SEARCH_CONVERSATION_PROCESSING_LEASE_SECONDS: value }),
      /Invalid search conversation configuration/u,
    );
  }
});
