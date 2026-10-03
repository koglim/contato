import test from "node:test";
import assert from "node:assert/strict";
import { readInteractiveActionConfig } from "./interactive-action.js";

test("readInteractiveActionConfig defaults to false when env var is absent", () => {
  const config = readInteractiveActionConfig({});
  assert.equal(config.enabled, false);
});

test("readInteractiveActionConfig parses true correctly", () => {
  const config = readInteractiveActionConfig({ INTERACTIVE_ACTIONS_ENABLED: "true" });
  assert.equal(config.enabled, true);
});

test("readInteractiveActionConfig parses false correctly", () => {
  const config = readInteractiveActionConfig({ INTERACTIVE_ACTIONS_ENABLED: "false" });
  assert.equal(config.enabled, false);
});

test("readInteractiveActionConfig throws on invalid value", () => {
  assert.throws(
    () => readInteractiveActionConfig({ INTERACTIVE_ACTIONS_ENABLED: "yes" }),
    /INTERACTIVE_ACTIONS_ENABLED must be true or false/
  );
});
