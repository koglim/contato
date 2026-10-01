import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { query, withTransaction, closeDatabaseConnection } from "../src/database/connection.js";
import { PostgresChannelInboundMessageRepository } from "../src/modules/channel-inbox/channel-inbox.repository.js";
import { InboxRecoveryService } from "../src/modules/channel-inbox/inbox-recovery.service.js";
import { InboxFenceError } from "../src/modules/channel-inbox/inbox-recovery.policy.js";
import { rollbackThrough } from "./rollback-helper.js";
import { channelInboundMessageResponseSchema, inboxQueueStatusSchema } from "@contatocerto/shared";

after(closeDatabaseConnection);
const headers = { "x-internal-key": "recovery-test" };
const repo = new PostgresChannelInboundMessageRepository();

async function fixture() {
  const provider = `recovery-${randomUUID()}`;
  const phones: string[] = [];
  const phone = () => { const value = `+5566${BigInt(`0x${randomUUID().replaceAll("-", "").slice(0,8)}`).toString().padStart(10,"0")}`; phones.push(value); return value; };
  const app = buildApp({ internalApiKey:headers["x-internal-key"] });
  const register = async (recipient = phone(), text = "ajuda") => {
    const input = { provider, provider_message_id:randomUUID(), phone_e164:recipient, raw_text:text, country_code:"BR",limit:3 };
    const {record} = await repo.createOrFind(input);
    return { ...record, input };
  };
  const process = () => app.inject({method:"POST",url:"/internal/channel/inbound/next/process",headers});
  const state = async (id: string) => (await query("SELECT * FROM channel_inbound_messages WHERE id=$1",[id])).rows[0];
  const due = (id: string) => query("UPDATE channel_inbound_messages SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE id=$1 AND next_attempt_at IS NOT NULL",[id]);
  const abandon = (id: string) => query("UPDATE channel_inbound_messages SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[id]);
  const cleanup = async () => {
    await app.close();
    await withTransaction(async db => {
      await db.query("DELETE FROM channel_inbound_recovery_events WHERE inbound_id IN (SELECT id FROM channel_inbound_messages WHERE provider=$1)",[provider]);
      await db.query("DELETE FROM channel_inbound_messages WHERE provider=$1",[provider]);
      await db.query("DELETE FROM search_conversations WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=ANY($1::text[]))",[phones]);
      await db.query("DELETE FROM search_requests WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=ANY($1::text[]))",[phones]);
      await db.query("DELETE FROM customers WHERE phone_e164=ANY($1::text[])",[phones]);
    });
  };
  return {app,provider,phone,register,process,state,due,abandon,cleanup};
}

test("Recovery empty queue returns 204 without consuming attempts or exposing a payload", async () => {
  const f=await fixture(); try { const response=await f.process(); assert.equal(response.statusCode,204,response.body); assert.equal(response.body,""); } finally {await f.cleanup();}
});

test("Recovery uses creation order and deterministic id tie-break, not UUID alone", async () => {
  const f=await fixture(); try {
    const first=await f.register(),second=await f.register();
    await query("UPDATE channel_inbound_messages SET created_at='2026-01-01' WHERE id IN ($1,$2)",[first.id,second.id]);
    assert.equal((await repo.claimNext(60))?.id,[first.id,second.id].sort()[0]);
    assert.equal((await repo.claimNext(60))?.id,[first.id,second.id].sort()[1]);
  } finally {await f.cleanup();}
});

test("Two workers process distinct clients independently, with one effective claim each", async () => {
  const f=await fixture(); try {
    const a=await f.register(),b=await f.register();
    const results=await Promise.all([f.process(),f.process()]);
    assert.ok(results.every(r=>r.statusCode===200 && r.json().status==='processed'),results.map(r=>r.body).join());
    assert.deepEqual(results.map(r=>r.json().id).sort(),[a.id,b.id].sort());
    assert.equal((await f.state(a.id)).attempt_count,1); assert.equal((await f.state(b.id)).attempt_count,1);
    assert.equal((await query("SELECT id FROM channel_outbound_messages WHERE provider=$1",[f.provider])).rows.length,2);
  } finally {await f.cleanup();}
});

test("FIFO blocks later messages from the same client, including equal timestamps and leased predecessors", async () => {
  const f=await fixture(); try {
    const phone=f.phone(),a=await f.register(phone),b=await f.register(phone),c=await f.register();
    await query("UPDATE channel_inbound_messages SET created_at='2026-01-01' WHERE id IN ($1,$2)",[a.id,b.id]);
    const [earlier,later]=[a.id,b.id].sort();
    assert.equal(await repo.claim(later,randomUUID(),60),null);
    assert.equal((await repo.claimNext(60))?.id,earlier);
    assert.equal((await repo.claimNext(60))?.id,c.id);
    assert.equal(await repo.claimNext(60),null); assert.equal((await f.state(later)).attempt_count,0);
  } finally {await f.cleanup();}
});

test("Concurrent consumers never claim the same inbound or consume attempts on contention", async () => {
  const f=await fixture(); try {
    const a=await f.register(); const claims=await Promise.all([repo.claimNext(60),repo.claimNext(60),repo.claimNext(60)]);
    assert.equal(claims.filter(Boolean).length,1); assert.equal((await f.state(a.id)).attempt_count,1);
  } finally {await f.cleanup();}
});

test("Abandoned lease is backed off and recovered; obsolete token cannot finalize or change state", async () => {
  const f=await fixture(); try {
    const a=await f.register(),first=await repo.claim(a.id,randomUUID(),60); assert.ok(first);
    await f.abandon(a.id); assert.equal(await repo.claimNext(60),null);
    const failed=await f.state(a.id); assert.equal(failed.attempt_count,1); assert.equal(failed.error_code,'lease_abandoned');
    assert.ok(failed.next_attempt_at.getTime()>Date.now());
    assert.equal(await repo.markFailed(a.id,first.processingToken!,"internal_error"),false);
    let effects=0; await assert.rejects(repo.runAtomic(first,async()=>{effects++;}),InboxFenceError); assert.equal(effects,0);
    await f.due(a.id); assert.equal((await f.process()).json().status,'processed');
    assert.equal((await f.state(a.id)).attempt_count,2); assert.ok((await f.state(a.id)).recovered_at);
    await assert.rejects(repo.runAtomic(first,async()=>{effects++;}),InboxFenceError); assert.equal(effects,0);
  } finally {await f.cleanup();}
});

test("Five failed effective attempts quarantine with 30/60/120/240 backoff and no sixth claim", async () => {
  const f=await fixture(); try {
    const a=await f.register();
    for(let attempt=1;attempt<=5;attempt++) {
      const claim=await repo.claim(a.id,randomUUID(),60);assert.ok(claim);
      const before=Date.now();assert.equal(await repo.markFailed(a.id,claim.processingToken!,"geocoding_unavailable"),true);
      assert.equal(await repo.markFailed(a.id,claim.processingToken!,"geocoding_unavailable"),false);
      const state=await f.state(a.id);assert.equal(state.attempt_count,attempt);
      if(attempt<5) { const delay=state.next_attempt_at.getTime()-before; assert.ok(delay>=30*2**(attempt-1)*1000-1000 && delay<30*2**(attempt-1)*1000+3000); assert.equal(await repo.claimNext(60),null);await f.due(a.id); }
      else {assert.equal(state.recovery_state,'quarantined');assert.equal(state.recovery_reason,'attempts_exhausted');assert.equal(state.next_attempt_at,null);}
    }
    assert.equal(await repo.claimNext(60),null);
    assert.equal((await query("SELECT id FROM channel_inbound_recovery_events WHERE inbound_id=$1 AND action='quarantine'",[a.id])).rows.length,1);
  } finally {await f.cleanup();}
});

test("Five abandoned leases also exhaust the limit without an infinite recovery loop", async () => {
  const f=await fixture(); try {
    const a=await f.register();
    for(let attempt=1;attempt<=5;attempt++) {assert.ok(await repo.claim(a.id,randomUUID(),60));await f.abandon(a.id);assert.equal(await repo.claimNext(60),null);await f.due(a.id);}
    assert.equal((await f.state(a.id)).recovery_state,'quarantined');assert.equal((await f.state(a.id)).attempt_count,5);
  } finally {await f.cleanup();}
});

test("Permanent failures quarantine immediately and block only their own client", async () => {
  const f=await fixture(); try {
    const a=await f.register(),b=await f.register(a.phoneE164),c=await f.register();
    const claim=await repo.claim(a.id,randomUUID(),60);assert.ok(claim);
    await repo.markFailed(a.id,claim.processingToken!,"dependency_missing");
    assert.equal((await f.state(a.id)).recovery_state,'quarantined');assert.equal((await f.state(a.id)).status,'failed');
    assert.equal(await repo.claim(b.id,randomUUID(),60),null);assert.equal((await f.process()).json().id,c.id);
  } finally {await f.cleanup();}
});

test("Administrative retry is authenticated, audited, fenced and idempotent; replay cannot reset another attempt", async () => {
  const f=await fixture(); try {
    const a=await f.register(),claim=await repo.claim(a.id,randomUUID(),60);assert.ok(claim);
    await repo.markFailed(a.id,claim.processingToken!,"dependency_missing");
    const payload={request_id:randomUUID(),operator_id:randomUUID(),action:'retry',reason:'dependency_restored'};
    const url=`/internal/channel/inbound/${a.id}/disposition`;
    assert.equal((await f.app.inject({method:'POST',url,payload})).statusCode,401);
    const response=await f.app.inject({method:'POST',url,headers,payload});assert.equal(response.statusCode,200,response.body);
    assert.equal((await f.state(a.id)).attempt_count,0);
    const next=await repo.claim(a.id,randomUUID(),60);assert.ok(next);
    const replay=await f.app.inject({method:'POST',url,headers,payload});assert.equal(replay.json().duplicate,true);
    assert.equal((await f.state(a.id)).processing_token,next.processingToken);assert.equal((await f.state(a.id)).total_attempts,2);
    assert.equal(await repo.markFailed(a.id,claim.processingToken!,"internal_error"),false);
    assert.equal((await f.app.inject({method:'POST',url,headers,payload:{...payload,action:'close'}})).statusCode,409);
    assert.equal((await query("SELECT id FROM channel_inbound_recovery_events WHERE inbound_id=$1 AND action='retry'",[a.id])).rows.length,1);
  } finally {await f.cleanup();}
});

test("Explicit administrative close preserves evidence and permits the next message without fictitious processing", async () => {
  const f=await fixture(); try {
    const a=await f.register(),b=await f.register(a.phoneE164),claim=await repo.claim(a.id,randomUUID(),60);assert.ok(claim);
    await repo.markFailed(a.id,claim.processingToken!,"dependency_missing");
    const payload={request_id:randomUUID(),operator_id:randomUUID(),action:'close',reason:'unrecoverable'};
    const response=await f.app.inject({method:'POST',url:`/internal/channel/inbound/${a.id}/disposition`,headers,payload});
    assert.equal(response.statusCode,200,response.body);const closed=await f.state(a.id);
    assert.equal(closed.status,'failed');assert.equal(closed.processed_at,null);assert.equal(closed.raw_text,a.rawText);assert.equal(closed.recovery_state,'closed');
    assert.equal((await f.process()).json().id,b.id);assert.equal((await f.state(b.id)).status,'processed');
    assert.equal((await query("SELECT id FROM channel_outbound_messages WHERE provider=$1",[f.provider])).rows.length,1);
  } finally {await f.cleanup();}
});

test("Payload conflict preserves the original input, quarantines with a hash and never invokes effects", async () => {
  const f=await fixture(); try {
    const a=await f.register();
    const response=await f.app.inject({method:'POST',url:'/internal/channel/inbound/messages',headers,payload:{...a.input,raw_text:'different private text'}});
    assert.equal(response.statusCode,409);assert.equal(response.json().error,'channel_message_payload_conflict');
    assert.equal((await f.state(a.id)).raw_text,a.rawText);assert.equal(await repo.claimNext(60),null);
    const audit=(await query("SELECT * FROM channel_inbound_recovery_events WHERE inbound_id=$1",[a.id])).rows;
    assert.equal(audit.length,1);assert.match(audit[0].evidence_hash,/^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(audit),/different private text|phone_e164|raw_text|processing_token/);
  } finally {await f.cleanup();}
});

test("Processing crash after domain writes and Outbox rolls back everything; retry completes once without B2", async () => {
  const f=await fixture(); try {
    const a=await f.register(f.phone(),'preciso de encanador perto daqui');
    await query(`CREATE FUNCTION recovery_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.provider='${f.provider}' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$`);
    await query("CREATE TRIGGER recovery_fail AFTER INSERT ON channel_outbound_messages FOR EACH ROW EXECUTE FUNCTION recovery_fail()");
    const failed=await f.process();assert.equal(failed.statusCode,200,failed.body);assert.equal(failed.json().status,'retry_scheduled');
    assert.equal((await query("SELECT id FROM customers WHERE phone_e164=$1",[a.phoneE164])).rows.length,0);
    assert.equal((await query("SELECT id FROM channel_outbound_messages WHERE provider=$1",[f.provider])).rows.length,0);
    await query("DROP TRIGGER recovery_fail ON channel_outbound_messages");await query("DROP FUNCTION recovery_fail()");
    assert.equal((await f.process()).statusCode,204);await f.due(a.id);
    const ok=await f.process();assert.equal(ok.json().status,'processed',ok.body);
    const saved=await f.state(a.id),outbox=(await query("SELECT id,text_content FROM channel_outbound_messages WHERE provider=$1",[f.provider])).rows;
    assert.equal(outbox.length,1);assert.ok(saved.conversation_id);
    for(let i=0;i<2;i++) {const replay=await f.app.inject({method:'POST',url:'/internal/channel/inbound/messages',headers,payload:a.input});assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().duplicate,true);assert.equal(replay.json().outbound.id,outbox[0].id);assert.equal(replay.json().reply_text,outbox[0].text_content);assert.equal(channelInboundMessageResponseSchema.safeParse(replay.json()).success,true);}
    assert.equal((await f.process()).statusCode,204);
    assert.equal((await query("SELECT id FROM customers WHERE phone_e164=$1",[a.phoneE164])).rows.length,1);
    assert.equal((await query("SELECT id FROM search_conversations WHERE customer_id=$1",[saved.customer_id])).rows.length,1);
  } finally {await query("DROP TRIGGER IF EXISTS recovery_fail ON channel_outbound_messages");await query("DROP FUNCTION IF EXISTS recovery_fail()");await f.cleanup();}
});

test("Processed invalid results quarantine instead of replaying or regenerating", async () => {
  const f=await fixture(); try {
    const a=await f.register();assert.equal((await f.process()).json().status,'processed');
    await query("UPDATE channel_inbound_messages SET result='{\"corrupt\":true}' WHERE id=$1",[a.id]);
    const response=await f.app.inject({method:'POST',url:'/internal/channel/inbound/messages',headers,payload:a.input});
    assert.equal(response.statusCode,500,response.body);assert.equal(response.json().error,'channel_message_result_invalid');
    assert.equal((await f.state(a.id)).recovery_state,'quarantined');
    assert.equal((await query("SELECT id FROM channel_outbound_messages WHERE provider=$1",[f.provider])).rows.length,1);
  } finally {await f.cleanup();}
});

test("Queue diagnostics expose only aggregate counts, ages and fencing signals", async () => {
  const f=await fixture();try {
    const a=await f.register(),claim=await repo.claim(a.id,randomUUID(),60);assert.ok(claim);
    await repo.markFailed(a.id,claim.processingToken!,"dependency_missing");await repo.recordFence(a.id,claim.processingToken!);await repo.recordFence(a.id,claim.processingToken!);
    const response=await f.app.inject({method:'GET',url:'/internal/channel/inbound/queue-status',headers});
    assert.equal(response.statusCode,200,response.body);assert.equal(inboxQueueStatusSchema.safeParse(response.json()).success,true);
    assert.ok(response.json().quarantined>=1);assert.ok(response.json().blocked_clients>=1);assert.ok(response.json().fencing_conflicts>=1);
    for(const privateValue of [a.phoneE164,a.rawText,a.id,claim.processingToken!]) assert.equal(response.body.includes(privateValue),false);
  }finally{await f.cleanup();}
});

test("Migration 019 refuses destructive rollback and preserves evidence/schema/018",async()=>{
  const f=await fixture();try {
    const a=await f.register(),claim=await repo.claim(a.id,randomUUID(),60);assert.ok(claim);await repo.markFailed(a.id,claim.processingToken!,"dependency_missing");
    const before=await f.state(a.id);
    await assert.rejects(rollbackThrough('019_add_inbox_recovery'),error=>/P0019/.test(String((error as {stderr?:string}).stderr)));
    assert.deepEqual(await f.state(a.id),before);
    assert.equal((await query("SELECT name FROM pgmigrations WHERE name IN ('018_add_contextual_conversation','019_add_inbox_recovery')")).rows.length,2);
    const index=(await query("SELECT pg_get_expr(indpred,indrelid) AS predicate FROM pg_index WHERE indexrelid='channel_inbound_recovery_phone_idx'::regclass")).rows[0];
    assert.match(index.predicate,/quarantined/);assert.match(index.predicate,/closed/);
    assert.equal((await query("SELECT id FROM channel_inbound_recovery_events WHERE inbound_id=$1",[a.id])).rows.length,1);
    await assert.rejects(query("UPDATE channel_inbound_recovery_events SET reason='changed' WHERE inbound_id=$1",[a.id]),error=>(error as {code:string}).code==='P0019');
  }finally{await f.cleanup();}
});

test("Disabled B2 recovery skips contextual entries without calling a model or consuming an attempt",async()=>{
  const f=await fixture();try {
    const a=await f.register();await query("UPDATE channel_inbound_messages SET contextual_queue=TRUE WHERE id=$1",[a.id]);
    assert.equal((await f.process()).statusCode,204);assert.equal((await f.state(a.id)).attempt_count,0);
    assert.equal((await f.app.inject({method:'POST',url:'/internal/channel/inbound/messages',headers,payload:a.input})).statusCode,409);
    assert.equal((await f.state(a.id)).attempt_count,0);
    // Service uses real repositories; this uncalled handler is only an assertion boundary.
    const admin=new InboxRecoveryService({receive:async()=>{throw new Error('not used');}},60);
    assert.ok(await admin.queueStatus());
  }finally{await f.cleanup();}
});
