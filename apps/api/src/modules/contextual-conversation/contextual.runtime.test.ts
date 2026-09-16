import assert from "node:assert/strict";
import test from "node:test";
import { ConversationAIProviderError, withConversationAITimeout } from "./contextual.provider.js";

test("conversation AI watchdog uses its configurable timeout", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    () => withConversationAITimeout(new Promise(() => {}), 20),
    (error: unknown) => error instanceof ConversationAIProviderError && error.reason === "timeout",
  );
  const duration = Date.now() - startedAt;
  assert.ok(duration >= 10, `watchdog returned too early: ${duration}ms`);
  assert.ok(duration < 1_000, `watchdog ignored the configured timeout: ${duration}ms`);
});

test("conversation AI watchdog returns valid results without falling back", async () => {
  const value = { status: "valid" };
  assert.equal(await withConversationAITimeout(Promise.resolve(value), 20), value);
});
