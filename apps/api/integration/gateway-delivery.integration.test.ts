import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { query, withTransaction, closeDatabaseConnection } from "../src/database/connection.js";
import { channelInboundMessageResponseSchema } from "@contatocerto/shared";
import { normalizeGatewayEvent, inboxDecision } from "../../../workflows/n8n/gateway-contract.mjs";
import { claimDecision, transportDecision, confirmationDecision } from "../../../workflows/n8n/delivery-contract.mjs";

after(closeDatabaseConnection);
const headers = { "x-internal-key": "gateway-contract-test" };
async function fixture(audio = false) {
  const provider = `gateway-${randomUUID()}`;
  const phone = `+5566${BigInt(`0x${randomUUID().replaceAll("-", "").slice(0,8)}`).toString().padStart(10,"0")}`;
  const app = buildApp({ internalApiKey: headers["x-internal-key"] });
  const config = { instance: "synthetic", origin: "https://evolution.example.invalid", provider };
  const now = Math.floor(Date.now()/1000);
  const normalized = normalizeGatewayEvent({ headers: { "content-type": "application/json" },
    jwtPayload: { app: "evolution", action: "webhook", iat: now, exp: now+600 },
    body: { instance: config.instance, server_url: config.origin, event: "messages.upsert",
      data: { key: { fromMe: false, id: randomUUID(), remoteJid: `${phone.slice(1)}@s.whatsapp.net` },
        message: audio ? { audioMessage: { seconds: 10, mimetype: "audio/ogg" }, base64: Buffer.from("OggS synthetic").toString("base64") } : { conversation: "ajuda" } } },
  }, config, now);
  // Legacy text Inbox compatibility; durable audio admission is exercised separately.
  const input = audio ? {...normalized.inbound,raw_text:'ajuda'} : normalized.inbound;
  const receive = (payload = input) => app.inject({ method:"POST", url:"/internal/channel/inbound/messages", headers, payload });
  const claim = (id = "next") => app.inject({ method:"POST", url:`/internal/channel/outbound/${id}/claim`, headers });
  const cleanup = async () => {
    await app.close();
    await withTransaction(async db => {
      await db.query('TRUNCATE channel_transport_events'); // Disposable serial test database only.
      await db.query("DELETE FROM channel_inbound_recovery_events WHERE inbound_id IN (SELECT id FROM channel_inbound_messages WHERE provider=$1)",[provider]);
      await db.query("DELETE FROM channel_inbound_messages WHERE provider=$1",[provider]);
      await db.query("DELETE FROM customers WHERE phone_e164=$1",[phone]);
    });
  };
  return { provider, app, receive, claim, cleanup, input };
}

test("real Inbox plus gateway/dispatcher race authorizes exactly one send and replays the same Outbox", async () => {
  const f = await fixture();
  try {
    const received = await f.receive(); assert.equal(received.statusCode,200,received.body);
    const original = channelInboundMessageResponseSchema.parse(received.json());
    const next = inboxDecision({statusCode:received.statusCode,body:received.body});
    assert.equal(next.action,"claim"); assert.equal(next.id,original.outbound.id);
    const claims = await Promise.all([f.claim(next.id), f.claim()]);
    const decisions = claims.map(r => claimDecision({statusCode:r.statusCode,body:r.body},f.provider));
    assert.equal(decisions.filter(d=>d.action==="send").length,1);
    assert.equal(decisions.filter(d=>d.action==="stop").length,1);
    const message = decisions.find(d=>d.action==="send")!.message;
    const sent = transportDecision({statusCode:201,body:JSON.stringify({key:{fromMe:true,id:"synthetic-delivered",remoteJid:`${message.recipient_phone_e164.slice(1)}@s.whatsapp.net`}})},message);
    assert.equal(sent.action,"sent");
    const confirm = () => f.app.inject({method:"POST",url:`/internal/channel/outbound/${message.id}/sent`,headers,payload:sent.payload});
    const first = await confirm(); assert.equal(first.statusCode,200,first.body);
    const repeat = await confirm(); assert.equal(repeat.statusCode,200,repeat.body);
    assert.equal(confirmationDecision({statusCode:repeat.statusCode,body:repeat.body},message,sent).action,"complete");
    const replay = await f.receive(); assert.equal(replay.statusCode,200,replay.body);
    assert.equal(replay.json().duplicate,true); assert.equal(replay.json().outbound.id,message.id);
    assert.equal(replay.json().reply_text,original.reply_text);
    const alreadySent = await f.claim(message.id);
    assert.equal(claimDecision({statusCode:alreadySent.statusCode,body:alreadySent.body},f.provider).reason,"sent");
    assert.equal((await query("SELECT id FROM channel_outbound_messages WHERE provider=$1",[f.provider])).rows.length,1);
    assert.equal((await query("SELECT provider_message_id FROM channel_outbound_messages WHERE id=$1",[message.id])).rows[0].provider_message_id,"synthetic-delivered");
    const conflict = await f.receive({...f.input,raw_text:"cancelar"});
    assert.equal(conflict.statusCode,409); assert.equal(conflict.json().error,"channel_message_payload_conflict");
    assert.equal((await query("SELECT raw_text FROM channel_inbound_messages WHERE provider=$1",[f.provider])).rows[0].raw_text,"ajuda");
  } finally { await f.cleanup(); }
});

test("uncertain transport is held in real PostgreSQL and neither consumer can retry it", async () => {
  for (const transport of [{error:"timeout"},{error:"ECONNRESET"},{statusCode:500},{statusCode:400,body:{}},{statusCode:201,body:{key:{id:"missing-recipient"}}}]) {
    const f = await fixture();
    try {
      const received=await f.receive(); assert.equal(received.statusCode,200,received.body);
      const claim=await f.claim(received.json().outbound.id);
      const message=claimDecision({statusCode:claim.statusCode,body:claim.body},f.provider).message;
      const outcome=transportDecision(transport,message); assert.equal(outcome.action,"hold");
      const hold=await f.app.inject({method:"POST",url:`/internal/channel/outbound/${message.id}/hold`,headers,payload:outcome.payload});
      assert.equal(hold.statusCode,200,hold.body);
      assert.equal(confirmationDecision({statusCode:hold.statusCode,body:hold.body},message,outcome).needs_reconciliation,true);
      await query("UPDATE channel_outbound_messages SET processing_started_at=NOW()-INTERVAL '5 minutes' WHERE id=$1",[message.id]);
      assert.equal((await f.claim()).statusCode,204);
      assert.equal((await f.claim(message.id)).statusCode,409);
      assert.equal((await query("SELECT status,delivery_hold_reason FROM channel_outbound_messages WHERE id=$1",[message.id])).rows[0].status,"processing");
    } finally { await f.cleanup(); }
  }
});

test("proven Evolution auth rejection uses real retry/backoff; same confirmation does not consume another attempt", async () => {
  const f=await fixture(); try {
    const received=await f.receive(); assert.equal(received.statusCode,200,received.body);
    const claim=await f.claim(received.json().outbound.id);
    const message=claimDecision({statusCode:claim.statusCode,body:claim.body},f.provider).message;
    const failure=transportDecision({statusCode:401,body:{status:401,error:"Unauthorized",response:{message:"Unauthorized"}}},message);
    assert.equal(failure.action,"failed");
    const fail=()=>f.app.inject({method:"POST",url:`/internal/channel/outbound/${message.id}/failed`,headers,payload:failure.payload});
    assert.equal((await fail()).statusCode,200); assert.equal((await fail()).statusCode,409);
    assert.equal((await f.claim()).statusCode,204);
    const state=(await query("SELECT status,attempt_count,next_attempt_at FROM channel_outbound_messages WHERE id=$1",[message.id])).rows[0];
    assert.equal(state.status,"pending"); assert.equal(state.attempt_count,1); assert.ok(state.next_attempt_at>Date.now());
  } finally {await f.cleanup();}
});

test("audio transcription enters the same real Inbox once, with the Evolution identity unchanged", async()=>{
  const f=await fixture(true); try {
    const first=await f.receive(), second=await f.receive();
    assert.equal(first.statusCode,200,first.body); assert.equal(second.statusCode,200,second.body);
    assert.equal(second.json().duplicate,true); assert.equal(first.json().outbound.id,second.json().outbound.id);
    const inbound=(await query("SELECT provider_message_id,raw_text FROM channel_inbound_messages WHERE provider=$1",[f.provider])).rows;
    assert.equal(inbound.length,1); assert.equal(inbound[0].provider_message_id,f.input.provider_message_id);
    assert.equal(inbound[0].raw_text,"ajuda");
  } finally {await f.cleanup();}
});
