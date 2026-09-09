import assert from "node:assert/strict";
import test from "node:test";
import { channelInboundMessageRequestSchema, customerSearchMessageRequestSchema, matchingSearchRequestSchema } from "@contatocerto/shared";
import { CANDIDATE_POOL_SIZE, MAX_PRESENTED_PER_SEARCH, presentationPageSize } from "./matching-policy.js";

test("presentation limits cannot enlarge the internal candidate pool or page", () => {
  assert.equal(CANDIDATE_POOL_SIZE, 20);
  assert.equal(MAX_PRESENTED_PER_SEARCH, 6);
  for (const [input, expected] of [[1, 1], [2, 2], [3, 3], [6, 3], [10, 3], [1000, 3], [0, 3], [-1, 3], [NaN, 3]]) {
    assert.equal(presentationPageSize(input), expected);
  }
  assert.equal(presentationPageSize(), 3);
  assert.equal(matchingSearchRequestSchema.safeParse({
    raw_text: "eletricista", service_id: "11111111-1111-4111-8111-111111111111",
    latitude: 0, longitude: 0, candidate_pool_size: 1000,
  }).success, false);
});

test("channel and customer routing accept a single selection digit, but never empty text", () => {
  const input = { phone_e164: "+5566999999999", raw_text: "1" };
  for (const raw_text of ["1", "6"]) {
    assert.equal(customerSearchMessageRequestSchema.safeParse({ ...input, raw_text }).success, true);
    assert.equal(channelInboundMessageRequestSchema.safeParse({ ...input, raw_text, provider: "test", provider_message_id: "one" }).success, true);
  }
  assert.equal(customerSearchMessageRequestSchema.safeParse({ ...input, raw_text: " " }).success, false);
});
