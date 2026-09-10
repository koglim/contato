import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import { inboxRecoveryRoutes } from "./inbox-recovery.routes.js";
import { inboxDispositionSchema, inboxRecoveryResponseSchema } from "@contatocerto/shared";

test("Inbox recovery routes authenticate every operation and treat empty queue as 204", async () => {
  const app = Fastify(); let calls = 0;
  await app.register(inboxRecoveryRoutes, { internalApiKey: "test-key", service: {
    processNext: async () => { calls++; return null; }, queueStatus: async () => ({} as never),
    dispose: async () => ({ error: "inbound_not_found" as const }),
  } });
  try {
    for (const [method,url] of [["POST","/next/process"],["GET","/queue-status"],["POST",`/${randomUUID()}/disposition`]] as const) {
      assert.equal((await app.inject({ method,url })).statusCode,401);
    }
    assert.equal(calls,0);
    const empty = await app.inject({ method:"POST",url:"/next/process",headers:{"x-internal-key":"test-key"} });
    assert.equal(empty.statusCode,204); assert.equal(empty.body,""); assert.equal(calls,1);
    assert.equal((await app.inject({method:"POST",url:`/${randomUUID()}/disposition`,headers:{"x-internal-key":"test-key"},payload:{action:"select"}})).statusCode,400);
  } finally { await app.close(); }
});
test("Recovery contracts expose neither phone, raw content, token nor consent powers", () => {
  assert.equal(inboxRecoveryResponseSchema.safeParse({ id:randomUUID(),status:"processed",phone_e164:"+5566999999999" }).success,false);
  assert.equal(inboxDispositionSchema.safeParse({ request_id:randomUUID(),operator_id:randomUUID(),action:"retry",reason:"context_reviewed" }).success,true);
  assert.equal(inboxDispositionSchema.safeParse({ request_id:randomUUID(),operator_id:randomUUID(),action:"share_contact",reason:"context_reviewed" }).success,false);
});
