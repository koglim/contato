import assert from "node:assert/strict";
import test from "node:test";
import { readChannelOutboundConfig } from "./channel-outbound.js";

test("channel outbound config accepts positive lease seconds only", () => {
  assert.deepEqual(readChannelOutboundConfig({}), { processingLeaseSeconds: 60 });
  assert.deepEqual(readChannelOutboundConfig({ CHANNEL_OUTBOUND_PROCESSING_LEASE_SECONDS: "15" }), { processingLeaseSeconds: 15 });
  for (const value of ["0", "-1", "1.5", "abc"]) {
    assert.throws(() => readChannelOutboundConfig({ CHANNEL_OUTBOUND_PROCESSING_LEASE_SECONDS: value }));
  }
});
