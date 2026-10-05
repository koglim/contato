import test from "node:test";
import assert from "node:assert/strict";
import {
  readInteractiveActionConfig,
  isInteractiveActionContactEligible,
} from "./interactive-action.js";

const PHONE_CUSTOMER = "+5511999999999";
const PHONE_PROFESSIONAL = "+5511888888888";
const PHONE_OTHER = "+5511777777777";

// Scenario 1: flag false => disabled
test("1. flag false => disabled", () => {
  const config = readInteractiveActionConfig({ INTERACTIVE_ACTIONS_ENABLED: "false" });
  assert.equal(config.enabled, false);
  assert.equal(
    isInteractiveActionContactEligible(PHONE_CUSTOMER, PHONE_PROFESSIONAL, config),
    false
  );
});

// Scenario 2: default flag absent => disabled
test("2. default flag absent => disabled", () => {
  const config = readInteractiveActionConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.rolloutMode, "allowlist");
  assert.equal(config.allowedPhones.size, 0);
  assert.equal(
    isInteractiveActionContactEligible(PHONE_CUSTOMER, PHONE_PROFESSIONAL, config),
    false
  );
});

// Scenario 3: invalid boolean => rejected
test("3. invalid boolean => rejected", () => {
  assert.throws(
    () => readInteractiveActionConfig({ INTERACTIVE_ACTIONS_ENABLED: "yes" }),
    /INTERACTIVE_ACTIONS_ENABLED must be true or false/
  );
});

// Scenario 4: enabled true + mode absent + list empty => allowlist / no eligible contact
test("4. enabled true + mode absent + list empty => allowlist / no eligible contact", () => {
  const config = readInteractiveActionConfig({
    INTERACTIVE_ACTIONS_ENABLED: "true",
  });
  assert.equal(config.enabled, true);
  assert.equal(config.rolloutMode, "allowlist");
  assert.equal(config.allowedPhones.size, 0);
  assert.equal(
    isInteractiveActionContactEligible(PHONE_CUSTOMER, PHONE_PROFESSIONAL, config),
    false,
    "Fail-closed: enabled=true with default empty allowlist must yield zero eligible contacts"
  );
});

// Scenario 5: enabled true + allowlist + both phones listed => eligible
test("5. enabled true + allowlist + both phones listed => eligible", () => {
  const config = readInteractiveActionConfig({
    INTERACTIVE_ACTIONS_ENABLED: "true",
    INTERACTIVE_ACTIONS_ROLLOUT_MODE: "allowlist",
    INTERACTIVE_ACTIONS_ALLOWED_PHONES: `${PHONE_CUSTOMER},${PHONE_PROFESSIONAL}`,
  });
  assert.equal(config.enabled, true);
  assert.equal(config.rolloutMode, "allowlist");
  assert.equal(config.allowedPhones.size, 2);
  assert.equal(
    isInteractiveActionContactEligible(PHONE_CUSTOMER, PHONE_PROFESSIONAL, config),
    true
  );
});

// Scenario 6: only customer listed => NOT eligible
test("6. only customer listed => NOT eligible", () => {
  const config = readInteractiveActionConfig({
    INTERACTIVE_ACTIONS_ENABLED: "true",
    INTERACTIVE_ACTIONS_ROLLOUT_MODE: "allowlist",
    INTERACTIVE_ACTIONS_ALLOWED_PHONES: PHONE_CUSTOMER,
  });
  assert.equal(
    isInteractiveActionContactEligible(PHONE_CUSTOMER, PHONE_PROFESSIONAL, config),
    false
  );
});

// Scenario 7: only professional listed => NOT eligible
test("7. only professional listed => NOT eligible", () => {
  const config = readInteractiveActionConfig({
    INTERACTIVE_ACTIONS_ENABLED: "true",
    INTERACTIVE_ACTIONS_ROLLOUT_MODE: "allowlist",
    INTERACTIVE_ACTIONS_ALLOWED_PHONES: PHONE_PROFESSIONAL,
  });
  assert.equal(
    isInteractiveActionContactEligible(PHONE_CUSTOMER, PHONE_PROFESSIONAL, config),
    false
  );
});

// Scenario 8: neither listed => NOT eligible
test("8. neither listed => NOT eligible", () => {
  const config = readInteractiveActionConfig({
    INTERACTIVE_ACTIONS_ENABLED: "true",
    INTERACTIVE_ACTIONS_ROLLOUT_MODE: "allowlist",
    INTERACTIVE_ACTIONS_ALLOWED_PHONES: PHONE_OTHER,
  });
  assert.equal(
    isInteractiveActionContactEligible(PHONE_CUSTOMER, PHONE_PROFESSIONAL, config),
    false
  );
});

// Scenario 9: whitespace CSV normalization
test("9. whitespace CSV normalization", () => {
  const config = readInteractiveActionConfig({
    INTERACTIVE_ACTIONS_ENABLED: "true",
    INTERACTIVE_ACTIONS_ROLLOUT_MODE: "allowlist",
    INTERACTIVE_ACTIONS_ALLOWED_PHONES: `  ${PHONE_CUSTOMER}  ,   ${PHONE_PROFESSIONAL}  `,
  });
  assert.equal(config.allowedPhones.size, 2);
  assert.equal(config.allowedPhones.has(PHONE_CUSTOMER), true);
  assert.equal(config.allowedPhones.has(PHONE_PROFESSIONAL), true);
  assert.equal(
    isInteractiveActionContactEligible(PHONE_CUSTOMER, PHONE_PROFESSIONAL, config),
    true
  );
});

// Scenario 10: duplicates handled
test("10. duplicates handled", () => {
  const config = readInteractiveActionConfig({
    INTERACTIVE_ACTIONS_ENABLED: "true",
    INTERACTIVE_ACTIONS_ROLLOUT_MODE: "allowlist",
    INTERACTIVE_ACTIONS_ALLOWED_PHONES: `${PHONE_CUSTOMER},${PHONE_CUSTOMER},${PHONE_PROFESSIONAL}`,
  });
  assert.equal(config.allowedPhones.size, 2);
  assert.equal(
    isInteractiveActionContactEligible(PHONE_CUSTOMER, PHONE_PROFESSIONAL, config),
    true
  );
});

// Scenario 11: malformed phone => fail fast
test("11. malformed phone => fail fast", () => {
  assert.throws(
    () =>
      readInteractiveActionConfig({
        INTERACTIVE_ACTIONS_ENABLED: "true",
        INTERACTIVE_ACTIONS_ALLOWED_PHONES: `${PHONE_CUSTOMER},not-a-phone`,
      }),
    /Invalid E\.164 phone number in INTERACTIVE_ACTIONS_ALLOWED_PHONES/
  );

  assert.throws(
    () =>
      readInteractiveActionConfig({
        INTERACTIVE_ACTIONS_ENABLED: "true",
        INTERACTIVE_ACTIONS_ALLOWED_PHONES: `${PHONE_CUSTOMER},`,
      }),
    /Invalid E\.164 phone number in INTERACTIVE_ACTIONS_ALLOWED_PHONES/
  );

  assert.throws(
    () =>
      readInteractiveActionConfig({
        INTERACTIVE_ACTIONS_ENABLED: "true",
        INTERACTIVE_ACTIONS_ALLOWED_PHONES: "11999999999",
      }),
    /Invalid E\.164 phone number in INTERACTIVE_ACTIONS_ALLOWED_PHONES/
  );
});

// Scenario 12: invalid rollout mode => fail fast
test("12. invalid rollout mode => fail fast", () => {
  assert.throws(
    () =>
      readInteractiveActionConfig({
        INTERACTIVE_ACTIONS_ENABLED: "true",
        INTERACTIVE_ACTIONS_ROLLOUT_MODE: "canary",
      }),
    /INTERACTIVE_ACTIONS_ROLLOUT_MODE must be 'allowlist' or 'all'/
  );

  assert.throws(
    () =>
      readInteractiveActionConfig({
        INTERACTIVE_ACTIONS_ENABLED: "true",
        INTERACTIVE_ACTIONS_ROLLOUT_MODE: "partial",
      }),
    /INTERACTIVE_ACTIONS_ROLLOUT_MODE must be 'allowlist' or 'all'/
  );
});

// Scenario 13: mode=all + enabled=true => eligible
test("13. mode=all + enabled=true => eligible", () => {
  const config = readInteractiveActionConfig({
    INTERACTIVE_ACTIONS_ENABLED: "true",
    INTERACTIVE_ACTIONS_ROLLOUT_MODE: "all",
  });
  assert.equal(config.enabled, true);
  assert.equal(config.rolloutMode, "all");
  assert.equal(
    isInteractiveActionContactEligible(PHONE_CUSTOMER, PHONE_PROFESSIONAL, config),
    true
  );
  assert.equal(
    isInteractiveActionContactEligible(PHONE_OTHER, "+5521999999999", config),
    true
  );
});

// Scenario 14: mode=all + enabled=false => disabled
test("14. mode=all + enabled=false => disabled", () => {
  const config = readInteractiveActionConfig({
    INTERACTIVE_ACTIONS_ENABLED: "false",
    INTERACTIVE_ACTIONS_ROLLOUT_MODE: "all",
  });
  assert.equal(config.enabled, false);
  assert.equal(config.rolloutMode, "all");
  assert.equal(
    isInteractiveActionContactEligible(PHONE_CUSTOMER, PHONE_PROFESSIONAL, config),
    false
  );
});
