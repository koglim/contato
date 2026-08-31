import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SEARCH_CONVERSATION_TTL_MINUTES, readSearchConversationConfig } from "./search-conversation.js";

test("search conversation configuration uses a 30 minute default", () => {
  assert.deepEqual(readSearchConversationConfig({}), { ttlMinutes: DEFAULT_SEARCH_CONVERSATION_TTL_MINUTES });
});

test("search conversation configuration accepts only positive integer TTL values", () => {
  assert.deepEqual(readSearchConversationConfig({ SEARCH_CONVERSATION_TTL_MINUTES: "45" }), { ttlMinutes: 45 });
  for (const value of ["0", "-1", "1.5", "invalid"]) {
    assert.throws(
      () => readSearchConversationConfig({ SEARCH_CONVERSATION_TTL_MINUTES: value }),
      /Invalid search conversation configuration/u,
    );
  }
});
