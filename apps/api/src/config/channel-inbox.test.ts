import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CHANNEL_INBOUND_PROCESSING_LEASE_SECONDS, readChannelInboxConfig } from "./channel-inbox.js";

test("channel inbox config defaults and rejects invalid processing leases", () => {
  assert.deepEqual(readChannelInboxConfig({}), { processingLeaseSeconds: DEFAULT_CHANNEL_INBOUND_PROCESSING_LEASE_SECONDS });
  assert.deepEqual(readChannelInboxConfig({ CHANNEL_INBOUND_PROCESSING_LEASE_SECONDS: "90" }), { processingLeaseSeconds: 90 });
  for (const value of ["0", "-1", "1.5", "invalid"]) {
    assert.throws(() => readChannelInboxConfig({ CHANNEL_INBOUND_PROCESSING_LEASE_SECONDS: value }));
  }
});
