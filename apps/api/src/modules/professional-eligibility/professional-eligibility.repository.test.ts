import assert from "node:assert/strict";
import test from "node:test";
import { toProfessionalEligibility } from "./professional-eligibility.repository.js";

const id = "11111111-1111-4111-8111-111111111111";
const complete = {
  professional_id: id,
  profile_status: "draft" as const,
  identity_verified: true,
  profile_complete: true,
  has_active_service: true,
  has_service_area: true,
};

test("eligibility-v1 is derived from the four readiness requirements and lifecycle", () => {
  const draft = toProfessionalEligibility(complete);
  assert.equal(draft.ready_to_publish, true);
  assert.equal(draft.can_appear_in_matching, false);
  assert.equal(draft.can_receive_opportunities, false);
  assert.equal(draft.can_set_available_now, false);
  assert.deepEqual(draft.reasons, ["profile_draft"]);

  const active = toProfessionalEligibility({ ...complete, profile_status: "active" });
  assert.equal(active.ready_to_publish, true);
  assert.equal(active.can_appear_in_matching, true);
  assert.equal(active.can_receive_opportunities, true);
  assert.equal(active.can_set_available_now, true);
  assert.deepEqual(active.reasons, []);
});

test("eligibility-v1 returns stable reason codes for missing requirements and suspension", () => {
  const result = toProfessionalEligibility({
    ...complete,
    profile_status: "suspended",
    identity_verified: false,
    profile_complete: false,
    has_active_service: false,
    has_service_area: false,
  });
  assert.equal(result.ready_to_publish, false);
  assert.equal(result.can_appear_in_matching, false);
  assert.equal(result.can_receive_opportunities, false);
  assert.equal(result.can_set_available_now, false);
  assert.deepEqual(result.reasons, [
    "identity_unverified",
    "profile_incomplete",
    "no_active_service",
    "no_service_area",
    "profile_suspended",
  ]);
});
