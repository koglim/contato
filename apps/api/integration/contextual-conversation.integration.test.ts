import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { query, withTransaction, closeDatabaseConnection } from "../src/database/connection.js";
import { ContextualConversationService } from "../src/modules/contextual-conversation/contextual.service.js";
import { PostgresContextualRepository } from "../src/modules/contextual-conversation/contextual.repository.js";
import { type ContextualProvider, type ContextualProposal } from "../src/modules/contextual-conversation/contextual.contract.js";
import { PostgresChannelInboundMessageRepository } from "../src/modules/channel-inbox/channel-inbox.repository.js";
import { rollbackThrough } from "./rollback-helper.js";
import type { LocationResolutionService } from "../src/modules/location-resolution/location-resolution.types.js";
import { ConversationAIProviderError, type ConversationAIFallbackEvent } from "../src/modules/contextual-conversation/contextual.provider.js";

after(closeDatabaseConnection);
const headers = { "x-internal-key": "b2-integration" };
const basic = (overrides: Partial<ContextualProposal> = {}): ContextualProposal => ({ intent: "search", services: [], location: null, uncertain: false, ...overrides });

test("B2 deterministic location clarification is persisted before effects; retry does not regenerate", async () => {
  const f = await fixture();
  try {
    f.setCompose(async () => { throw new Error("composer must not run for missing location"); });
    await query(`CREATE FUNCTION b2_fail_outbound() RETURNS trigger AS $$ BEGIN
      IF NEW.recipient_phone_e164 = '${f.phone}' THEN RAISE EXCEPTION 'injected B2 outbox failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await query("CREATE TRIGGER b2_fail_outbound BEFORE INSERT ON channel_outbound_messages FOR EACH ROW EXECUTE FUNCTION b2_fail_outbound()");
    const id = randomUUID(), text = `preciso de ${f.name}`;
    assert.equal((await f.receive(text, id)).statusCode, 500);
    assert.equal((await query("SELECT id FROM search_conversations WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [f.phone])).rows.length, 0);
    const calls = f.calls(), compositions = f.compositions();
    await query("DROP TRIGGER b2_fail_outbound ON channel_outbound_messages"); await query("DROP FUNCTION b2_fail_outbound()");
    assert.equal((await f.receive(text,id)).statusCode,409,"backoff must prevent immediate retries");
    await query("UPDATE channel_inbound_messages SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE provider_message_id=$1 AND phone_e164=$2",[id,f.phone]);
    const retry = await f.receive(text, id); assert.equal(retry.statusCode, 200, retry.body);
    assert.equal(retry.json().reply_text, `Em qual cidade você precisa de ${f.name}?`);
    assert.equal(f.compositions(), 0);
    assert.equal(f.calls(), calls); assert.equal(f.compositions(), compositions);
    await f.sent(retry.json().outbound.id);
    const replay = await f.receive(text, id); assert.equal(replay.json().outbound.status, "sent");
    assert.equal(replay.json().reply_text, retry.json().reply_text); assert.equal(f.calls(), calls);
  } finally {
    await query("DROP TRIGGER IF EXISTS b2_fail_outbound ON channel_outbound_messages"); await query("DROP FUNCTION IF EXISTS b2_fail_outbound()");
    await f.cleanup();
  }
});

test("B2 budget exhaustion and model timeout preserve slots with a useful fallback", async () => {
  const f = await fixture();
  try {
    f.set(async () => basic()); await f.receive(`Preciso de ${f.name}`);
    const before = await f.state(), calls = f.calls(), fallbackCountBeforeScenario = f.fallbackEvents().length;
    await query(`UPDATE contextual_budgets SET calls=20 WHERE scope IN (SELECT id::text FROM customers WHERE phone_e164=$1)`, [f.phone]);
    const exhausted = await f.receive("Na verdade é em Vera"); assert.equal(exhausted.statusCode, 200, exhausted.body);
    assert.equal(exhausted.json().result.status, "fallback"); assert.equal(f.calls(), calls);
    assert.deepEqual((await f.state()).memory, before.memory);
    await query(`DELETE FROM contextual_budgets WHERE scope IN (SELECT id::text FROM customers WHERE phone_e164=$1)`, [f.phone]);
    f.set(() => new Promise(() => {}));
    const timeout = await f.receive("Ainda preciso desse atendimento"); assert.equal(timeout.statusCode, 200, timeout.body);
    assert.equal(timeout.json().result.status, "fallback"); assert.deepEqual((await f.state()).memory, before.memory);
    const scenarioFallbacks = f.fallbackEvents().slice(fallbackCountBeforeScenario);
    assert.deepEqual({ reason: scenarioFallbacks[0]?.reason, model: scenarioFallbacks[0]?.model, stage: scenarioFallbacks[0]?.stage },
      { reason: "policy_limit", model: "unit-fake-no-model-call", stage: "budget" });
    assert.equal(scenarioFallbacks.length, 2);
    assert.deepEqual({ reason: scenarioFallbacks[1]?.reason, model: scenarioFallbacks[1]?.model, stage: scenarioFallbacks[1]?.stage },
      { reason: "timeout", model: "unit-fake-no-model-call", stage: "interpretation" });
    assert.ok((scenarioFallbacks[1]?.durationMs ?? 0) >= 20);
  } finally { await f.cleanup(); }
});

test("B2 global command wins over model and stored hypotheses", async () => {
  const f = await fixture();
  try {
    f.set(async () => basic()); await f.receive(`Preciso de ${f.name}`);
    const calls = f.calls();
    f.set(async () => { throw new Error("model must not execute for global command"); });
    const result = await f.receive("cancelar"); assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().result.route, "global_command"); assert.equal(f.calls(), calls);
    assert.equal((await f.state()).id, null); assert.equal((await f.state()).memory.service, null);
  } finally { await f.cleanup(); }
});

test("B2 old proposal cannot be reused after an external context change", async () => {
  const f = await fixture();
  try {
    f.set(async () => basic()); await f.receive(`Preciso de ${f.name}`);
    const state = await f.state();
    const inbox = new PostgresChannelInboundMessageRepository(), repository = new PostgresContextualRepository();
    const registered = await inbox.createOrFind({ provider: "b2-test", provider_message_id: randomUUID(), phone_e164: f.phone, raw_text: "quanto custa usar?", country_code: "BR", limit: 3 });
    const record = await inbox.claim(registered.record.id, randomUUID(), 60); assert.ok(record);
    const snapshot = await repository.acquire(record, "fake");
    await repository.saveProposal(record, snapshot, basic({ intent: "faq_cost" }));
    await query("UPDATE search_conversations SET location_text='Sorriso' WHERE id=$1", [state.id]);
    let effects = 0;
    await assert.rejects(repository.commit(record, snapshot, async () => { effects++; return { value: true, memory: snapshot.memory }; }));
    assert.equal(effects, 0); await repository.release(snapshot);
    // Recovery must not reinterpret this old message against a different search.
    await assert.rejects(repository.acquire(record,"fake"));
  } finally { await f.cleanup(); }
});

test("B2 arrival FIFO includes an earlier inbound before its contextual handler starts", async () => {
  const f = await fixture();
  try {
    f.set(async () => basic({ intent: "faq_cost" }));
    const inbox = new PostgresChannelInboundMessageRepository();
    const payload = (id: string) => ({ provider: "b2-test", provider_message_id: id, phone_e164: f.phone, raw_text: "Quanto custa usar?", country_code: "BR", limit: 3 });
    const firstId = randomUUID(), secondId = randomUUID();
    await inbox.createOrFind(payload(firstId), { contextual: true });
    const second = await inbox.createOrFind(payload(secondId), { contextual: true });
    const claimed = await inbox.claim(second.record.id, randomUUID(), 60); assert.equal(claimed,null,"FIFO now rejects before consuming an attempt");
    assert.equal((await query("SELECT attempt_count FROM channel_inbound_messages WHERE id=$1",[second.record.id])).rows[0].attempt_count,0);
    assert.equal((await query("SELECT id FROM channel_outbound_messages WHERE recipient_phone_e164=$1", [f.phone])).rows.length, 0);
    const first = await f.receive("Quanto custa usar?", firstId); assert.equal(first.statusCode, 200, first.body);
    const retry = await f.receive("Quanto custa usar?", secondId); assert.equal(retry.statusCode, 200, retry.body);
    assert.notEqual(first.json().outbound.id, retry.json().outbound.id);
  } finally { await f.cleanup(); }
});

for (const stage of ["before_proposal","after_proposal","after_draft"] as const) {
  test(`Autonomous B2 recovery ${stage} reuses compatible artifacts without regenerating them`,async()=>{
    const f=await fixture();const inbox=new PostgresChannelInboundMessageRepository(),context=new PostgresContextualRepository();
    try {
      f.set(async()=>basic({speech_act:"request"}));
      f.setCompose(async input=>({target:input.target,question:"Em qual cidade precisa desse atendimento?"}));
      const payload={provider:"b2-test",provider_message_id:randomUUID(),phone_e164:f.phone,raw_text:`Preciso de ${f.name}`,country_code:"BR",limit:3};
      const registered=await inbox.createOrFind(payload,{contextual:true}),record=await inbox.claim(registered.record.id,randomUUID(),60);assert.ok(record);
      const snapshot=await context.acquire(record,"fake");
      if(stage!=="before_proposal") await context.saveProposal(record,snapshot,basic({speech_act:"request"}));
      if(stage==="after_draft") await context.saveDraft(record,snapshot,"Em qual cidade precisa desse atendimento?");
      await query("UPDATE channel_inbound_messages SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[record.id]);
      await query("UPDATE contextual_memories SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE customer_id=$1",[snapshot.customerId]);
      assert.equal((await f.app.inject({method:"POST",url:"/internal/channel/inbound/next/process",headers})).statusCode,204);
      await query("UPDATE channel_inbound_messages SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE id=$1",[record.id]);
      const recovered=await f.app.inject({method:"POST",url:"/internal/channel/inbound/next/process",headers});
      assert.equal(recovered.statusCode,200,recovered.body);assert.equal(recovered.json().status,"processed",recovered.body);
      assert.equal(f.calls(),stage==="before_proposal"?1:0);assert.equal(f.compositions(),0);
      let effects=0;
      await assert.rejects(context.acquire(record,"fake"));
      await assert.rejects(context.saveProposal(record,snapshot,basic()));
      await assert.rejects(context.saveDraft(record,snapshot,"Qual outro serviço?"));
      await assert.rejects(context.commit(record,snapshot,async()=>{effects++;return{value:true,memory:snapshot.memory};}));
      assert.equal(effects,0);assert.equal((await f.state()).revision,1);
      const replay=await f.receive(payload.raw_text,payload.provider_message_id);assert.equal(replay.json().duplicate,true);
      assert.equal(f.calls(),stage==="before_proposal"?1:0);assert.equal(f.compositions(),0);
      assert.equal((await query("SELECT id FROM channel_outbound_messages WHERE recipient_phone_e164=$1",[f.phone])).rows.length,1);
      assert.equal((await query("SELECT id FROM search_conversations WHERE customer_id=$1",[snapshot.customerId])).rows.length,1);
    }finally{await f.cleanup();}
  });
}

for(const boundary of ["search","outbox"] as const) {
  test(`Autonomous B2 retry after crash at ${boundary} commits exactly one search, conversation, memory and Outbox`,async()=>{
    const f=await fixture();try {
      f.set(async()=>basic({speech_act:"request",location:{text:"Sinop",evidence:"Sinop"}}));
      const table=boundary==="search"?"search_requests":"channel_outbound_messages";
      const condition=boundary==="search"?`NEW.service_id='${f.serviceId}'`:`NEW.recipient_phone_e164='${f.phone}'`;
      await query(`CREATE FUNCTION recovery_b2_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'injected crash'; END IF; RETURN NEW; END $$`);
      await query(`CREATE TRIGGER recovery_b2_fail AFTER INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION recovery_b2_fail()`);
      const id=randomUUID(),text=`Preciso de ${f.name} em Sinop`;
      assert.equal((await f.receive(text,id)).statusCode,500);
      assert.equal((await query("SELECT id FROM search_requests WHERE service_id=$1",[f.serviceId])).rows.length,0);
      assert.equal((await query("SELECT id FROM channel_outbound_messages WHERE recipient_phone_e164=$1",[f.phone])).rows.length,0);
      assert.equal((await f.state()).revision,0);const calls=f.calls();
      await query(`DROP TRIGGER recovery_b2_fail ON ${table}`);await query("DROP FUNCTION recovery_b2_fail()");
      await query("UPDATE channel_inbound_messages SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE phone_e164=$1",[f.phone]);
      const response=await f.app.inject({method:"POST",url:"/internal/channel/inbound/next/process",headers});
      assert.equal(response.json().status,"processed",response.body);assert.equal(f.calls(),calls);
      const replay=await f.receive(text,id);assert.equal(replay.json().duplicate,true);assert.equal(f.calls(),calls);
      assert.equal((await query("SELECT id FROM search_requests WHERE service_id=$1",[f.serviceId])).rows.length,1);
      assert.equal((await query("SELECT id FROM channel_outbound_messages WHERE recipient_phone_e164=$1",[f.phone])).rows.length,1);
      assert.equal((await f.state()).revision,1);
      await f.sent(replay.json().outbound.id);
      const choiceId=randomUUID(),chosen=await f.receive("quero o segundo",choiceId);assert.equal(chosen.statusCode,200,chosen.body);
      assert.equal(chosen.json().result.result.kind,"selected");
      const again=await f.receive("quero o segundo",choiceId);assert.equal(again.json().outbound.id,chosen.json().outbound.id);
      const customer=(await f.state()).memory;
      assert.ok(customer);
      assert.equal((await query("SELECT id FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)",[f.phone])).rows.length,1);
      assert.equal((await query("SELECT id FROM channel_outbound_messages WHERE purpose='professional_contact_notification' AND business_key IN (SELECT 'contact:'||id||':initial' FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1))",[f.phone])).rows.length,1);
    }finally {
      await query(`DROP TRIGGER IF EXISTS recovery_b2_fail ON ${boundary==="search"?"search_requests":"channel_outbound_messages"}`);
      await query("DROP FUNCTION IF EXISTS recovery_b2_fail()");await f.cleanup();
    }
  });
}

test("Recovery quarantines corrupt persisted proposals rather than hiding corruption as an AI fallback",async()=>{
  const f=await fixture();try {
    const inbox=new PostgresChannelInboundMessageRepository(),context=new PostgresContextualRepository();
    const registered=await inbox.createOrFind({provider:"b2-test",provider_message_id:randomUUID(),phone_e164:f.phone,raw_text:"Quanto custa usar?",country_code:"BR",limit:3},{contextual:true});
    const record=await inbox.claim(registered.record.id,randomUUID(),60);assert.ok(record);
    const snapshot=await context.acquire(record,"fake");await context.release(snapshot);
    await query("UPDATE contextual_turns SET proposal='{\"execute\":\"share_contacts\"}' WHERE inbound_id=$1",[record.id]);
    await inbox.markFailed(record.id,record.processingToken!,"internal_error");
    await query("UPDATE channel_inbound_messages SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE id=$1",[record.id]);
    const response=await f.app.inject({method:"POST",url:"/internal/channel/inbound/next/process",headers});
    assert.equal(response.json().status,"quarantined",response.body);assert.equal(f.calls(),0);
    assert.equal((await query("SELECT id FROM channel_outbound_messages WHERE recipient_phone_e164=$1",[f.phone])).rows.length,0);
    assert.equal((await query("SELECT recovery_reason FROM channel_inbound_messages WHERE id=$1",[record.id])).rows[0].recovery_reason,"persisted_proposal_invalid");
  }finally{await f.cleanup();}
});

test("Recovery after context expiration preserves confirmed slots but cannot select expired candidates",async()=>{
  const f=await fixture();try {
    f.set(async()=>basic({speech_act:"request",location:{text:"Sinop",evidence:"Sinop"}}));
    const first=await f.receive(`Preciso de ${f.name} em Sinop`);await f.sent(first.json().outbound.id);
    const before=await f.state(),inbox=new PostgresChannelInboundMessageRepository();
    const registered=await inbox.createOrFind({provider:"b2-test",provider_message_id:randomUUID(),phone_e164:f.phone,raw_text:"quero o segundo",country_code:"BR",limit:3},{contextual:true});
    await query("UPDATE search_conversations SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[before.id]);
    f.set(async()=>basic({intent:"selection",speech_act:"request"}));
    const response=await f.app.inject({method:"POST",url:"/internal/channel/inbound/next/process",headers});
    assert.equal(response.json().id,registered.record.id);assert.equal(response.json().status,"processed",response.body);
    assert.equal((await query("SELECT id FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)",[f.phone])).rows.length,0);
    const after=await f.state();assert.equal(after.memory.service.value,f.name);assert.equal(after.memory.location.value,"Sinop");assert.equal(after.memory.conversationId,null);
  }finally{await f.cleanup();}
});

test("Recovery preserves a changed memory revision and its old checkpoint without applying a stale choice", async () => {
  const f=await fixture(), inbox=new PostgresChannelInboundMessageRepository(), context=new PostgresContextualRepository();
  try {
    f.set(async()=>basic({speech_act:"request"}));
    await f.receive(`Preciso de ${f.name}`);
    const payload={provider:"b2-test",provider_message_id:randomUUID(),phone_e164:f.phone,raw_text:"em Sinop",country_code:"BR",limit:3};
    const registered=await inbox.createOrFind(payload,{contextual:true});
    const record=await inbox.claim(registered.record.id,randomUUID(),60);assert.ok(record);
    const snapshot=await context.acquire(record,"fake");
    const proposal=basic({speech_act:"request",location:{text:"Sinop",evidence:"Sinop"}});
    await context.saveProposal(record,snapshot,proposal);await context.release(snapshot);
    await inbox.markFailed(record.id,record.processingToken!,"internal_error");
    const memory={...snapshot.memory,location:{value:"Vera",source:"user_explicit",inboundId:randomUUID()}};
    await query("UPDATE contextual_memories SET revision=revision+1,memory=$2::jsonb WHERE customer_id=$1",[snapshot.customerId,JSON.stringify(memory)]);
    await query("UPDATE channel_inbound_messages SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE id=$1",[record.id]);
    const calls=f.calls(),recovered=await f.app.inject({method:"POST",url:"/internal/channel/inbound/next/process",headers});
    assert.equal(recovered.json().status,"processed",recovered.body);
    assert.deepEqual((await f.state()).memory,memory);assert.equal((await f.state()).revision,snapshot.revision+1);
    const checkpoint=(await query("SELECT proposal,context_revision FROM contextual_turns WHERE inbound_id=$1",[record.id])).rows[0];
    assert.deepEqual(checkpoint.proposal,proposal);assert.equal(checkpoint.context_revision,snapshot.revision);
    const replay=await f.receive(payload.raw_text,payload.provider_message_id);
    assert.equal(replay.json().duplicate,true);assert.equal(replay.json().result.status,"clarification");
    assert.equal(f.calls(),calls);assert.equal(f.geoCalls(),0);
    assert.equal((await query("SELECT id FROM search_requests WHERE service_id=$1",[f.serviceId])).rows.length,0);
    assert.equal((await query("SELECT id FROM contacts WHERE customer_id=$1",[snapshot.customerId])).rows.length,0);
  } finally {await f.cleanup();}
});

for (const dependency of ["model","geocoder"] as const) {
  test(`Autonomous recovery with unavailable ${dependency} persists one safe fallback and replays without external work`,async()=>{
    const f=await fixture(), inbox=new PostgresChannelInboundMessageRepository(), context=new PostgresContextualRepository();
    try {
      f.set(async()=> {if(dependency==="model") throw new Error("private provider failure");return basic({speech_act:"request",location:{text:"Sinop",evidence:"Sinop"}});});
      if(dependency==="geocoder") f.setGeo(async()=>{throw new Error("private geocoder failure");});
      const payload={provider:"b2-test",provider_message_id:randomUUID(),phone_e164:f.phone,
        raw_text:dependency==="model"?`Pode procurar ${f.name} em Sinop?`:`Preciso de ${f.name} em Sinop`,country_code:"BR",limit:3};
      const registered=await inbox.createOrFind(payload,{contextual:true}), record=await inbox.claim(registered.record.id,randomUUID(),60);assert.ok(record);
      const snapshot=await context.acquire(record,"fake");
      await query("UPDATE channel_inbound_messages SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[record.id]);
      await query("UPDATE contextual_memories SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE customer_id=$1",[snapshot.customerId]);
      assert.equal((await f.app.inject({method:"POST",url:"/internal/channel/inbound/next/process",headers})).statusCode,204);
      await query("UPDATE channel_inbound_messages SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE id=$1",[record.id]);
      const recovered=await f.app.inject({method:"POST",url:"/internal/channel/inbound/next/process",headers});
      assert.equal(recovered.json().status,"processed",recovered.body);
      const calls=f.calls(),geo=f.geoCalls();
      const replay=await f.receive(payload.raw_text,payload.provider_message_id);
      assert.equal(replay.json().duplicate,true);assert.equal(replay.json().result.status,"fallback");
      assert.doesNotMatch(replay.body,/private provider|private geocoder/);
      assert.equal(f.fallbackEvents().length,1);
      assert.deepEqual({reason:f.fallbackEvents()[0]?.reason,stage:f.fallbackEvents()[0]?.stage,model:f.fallbackEvents()[0]?.model},
        dependency==="model"
          ? {reason:"provider_error",stage:"interpretation",model:"unit-fake-no-model-call"}
          : {reason:"dependency_error",stage:"location_resolution",model:"unit-fake-no-model-call"});
      assert.deepEqual((await f.state()).memory,snapshot.memory);
      assert.equal(f.calls(),calls);assert.equal(f.geoCalls(),geo);
      assert.equal((await query("SELECT id FROM search_requests WHERE service_id=$1",[f.serviceId])).rows.length,0);
      assert.equal((await query("SELECT id FROM channel_outbound_messages WHERE channel_inbound_message_id=$1",[record.id])).rows.length,1);
    }finally{await f.cleanup();}
  });
}

async function fixture() {
  const serviceId = randomUUID(), categoryId = randomUUID();
  const serviceIds = [serviceId];
  // Keep uniqueness without random phone-like digit runs in public labels.
  // Otherwise the PII sanitizer correctly removes some UUID suffixes, making
  // exact fallback/replay assertions probabilistic. Do not weaken that guard.
  const suffix = serviceId.replaceAll("-", "").replace(/[0-9]/gu, digit => String.fromCharCode(103 + Number(digit)));
  const name = `Encanador${suffix}`;
  assert.match(name, /^[A-Za-z]+$/u);
  const phone = `+5566${BigInt(`0x${randomUUID().replaceAll("-", "").slice(0, 8)}`).toString().padStart(10, "0")}`;
  const professionalIds = [randomUUID(), randomUUID()];
  await query("INSERT INTO service_categories(id,name,slug) VALUES ($1::uuid,'B2 fixture',$1::text)", [categoryId]);
  await query("INSERT INTO services(id,category_id,name,slug) VALUES ($1,$2,$3,$3)", [serviceId, categoryId, name]);
  await query("INSERT INTO service_aliases(service_id,alias,normalized_alias) VALUES ($1,'tomada','tomada')", [serviceId]);
  for (const [index, id] of professionalIds.entries()) {
    await query("INSERT INTO professionals(id,display_name,slug,phone_e164,status) VALUES ($1::uuid,$2,$1::text,$3,'active')", [id, `Profissional ${index + 1}`, `+5566${Math.floor(Math.random() * 1e9).toString().padStart(9, "0")}`]);
    await query("INSERT INTO professional_services(professional_id,service_id) VALUES ($1,$2)", [id, serviceId]);
    await query(`INSERT INTO professional_service_areas(professional_id,city,state,country_code,center,radius_meters)
      VALUES ($1,'Sinop','MT','BR',ST_SetSRID(ST_MakePoint(-55.5,-11.86),4326)::geography,10000)`, [id]);
  }
  let calls = 0, geoCalls = 0;
  const fallbackEvents: ConversationAIFallbackEvent[] = [];
  const executionEvents: Array<{ path: string; interpretationCalled: boolean; compositionCalled: boolean; finalStatus: string }> = [];
  let next: (text: string) => Promise<unknown> = async () => basic();
  let compose: ContextualProvider["composeQuestion"];
  let compositions = 0;
  const provider: ContextualProvider = { model: "unit-fake-no-model-call", async interpret(input) { calls++; return next(input.message); },
    async composeQuestion(input) { compositions++; if (!compose) throw new Error("no fake composer configured"); return compose(input); } };
  let resolveLocation: LocationResolutionService["resolve"] = async input => {
    return { status: "resolved", query: input.query, country_code: "BR", provider: "fake", candidates: [],
      match: { label: input.query, latitude: -11.86, longitude: -55.5, city: input.query, state: "MT", country_code: "BR", neighborhood: null, confidence: 1, layer: "locality" } };
  };
  const contextual = new ContextualConversationService(provider, { async resolve(input) { geoCalls++; return resolveLocation(input); } }, {
    timeoutMs: 25,
    onFallback: event => fallbackEvents.push(event),
    onExecutionPath: event => executionEvents.push(event),
  });
  const app = buildApp({ internalApiKey: "b2-integration", contextualConversation: contextual });
  const receive = (text: string, id = randomUUID()) => app.inject({ method: "POST", url: "/internal/channel/inbound/messages", headers,
    payload: { provider: "b2-test", provider_message_id: id, phone_e164: phone, raw_text: text } });
  const sent = async (id: string) => {
    const claim = await app.inject({ method: "POST", url: `/internal/channel/outbound/${id}/claim`, headers });
    assert.equal(claim.statusCode, 200, claim.body);
    const result = await app.inject({ method: "POST", url: `/internal/channel/outbound/${id}/sent`, headers,
      payload: { processing_token: claim.json().processing_token, provider_message_id: randomUUID() } });
    assert.equal(result.statusCode, 200, result.body);
  };
  const state = async () => (await query(`SELECT c.id, c.pending_slot, c.search_request_id, m.memory, m.revision
    FROM contextual_memories m JOIN customers u ON u.id = m.customer_id
    LEFT JOIN search_conversations c ON c.customer_id = u.id AND c.status = 'active' WHERE u.phone_e164 = $1`, [phone])).rows[0];
  const cleanup = async () => {
    await app.close();
    await withTransaction(async client => {
      await client.query("DELETE FROM contextual_turns WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [phone]);
      await client.query("DELETE FROM contextual_budgets WHERE scope IN (SELECT id::text FROM customers WHERE phone_e164=$1)", [phone]);
      await client.query("DELETE FROM contextual_memories WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [phone]);
      await client.query("DELETE FROM channel_outbound_messages WHERE recipient_phone_e164=$1 OR business_key IN (SELECT 'contact:'||id||':initial' FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1))", [phone]);
      await client.query("DELETE FROM channel_inbound_recovery_events WHERE inbound_id IN (SELECT id FROM channel_inbound_messages WHERE phone_e164=$1)", [phone]);
      await client.query("DELETE FROM channel_inbound_messages WHERE phone_e164=$1", [phone]);
      await client.query("DELETE FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [phone]);
      await client.query("DELETE FROM search_conversations WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [phone]);
      await client.query("DELETE FROM matches WHERE search_request_id IN (SELECT id FROM search_requests WHERE service_id=ANY($1::uuid[]))", [serviceIds]);
      await client.query("DELETE FROM search_requests WHERE service_id=ANY($1::uuid[])", [serviceIds]);
      await client.query("DELETE FROM customers WHERE phone_e164=$1", [phone]);
      await client.query("DELETE FROM professional_service_areas WHERE professional_id=ANY($1::uuid[])", [professionalIds]);
      await client.query("DELETE FROM professional_services WHERE service_id=ANY($1::uuid[])", [serviceIds]);
      await client.query("DELETE FROM professionals WHERE id=ANY($1::uuid[])", [professionalIds]);
      await client.query("DELETE FROM services WHERE id=ANY($1::uuid[])", [serviceIds]);
      await client.query("DELETE FROM service_categories WHERE id=$1", [categoryId]);
    });
  };
  const addService = async () => {
    const id = randomUUID(), name = `Eletricista${id.replaceAll("-", "")}`;
    serviceIds.push(id);
    await query("INSERT INTO services(id,category_id,name,slug) VALUES ($1,$2,$3,$3)", [id, categoryId, name]);
    for (const professionalId of professionalIds) await query("INSERT INTO professional_services(professional_id,service_id) VALUES ($1,$2)", [professionalId, id]);
    return { id, name };
  };
  const addAlias = async (alias: string) => {
    await query("INSERT INTO service_aliases(service_id,alias,normalized_alias) VALUES ($1,$2,$3)", [serviceId, alias, alias.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()]);
  };
  return { name, phone, serviceId, app, receive, sent, state, cleanup, addService, calls: () => calls, geoCalls: () => geoCalls, compositions: () => compositions,
    fallbackEvents: () => fallbackEvents, executionEvents: () => executionEvents, set: (fn: typeof next) => { next = fn; }, setCompose: (fn: NonNullable<typeof compose>) => { compose = fn; }, addAlias,
    setGeo: (fn: typeof resolveLocation) => { resolveLocation = fn; } };
}

for (const city of ["Cuiabá", "Sinop"] as const) {
  test(`B2 direct request in ${city} searches without interpretation or composition`, async () => {
    const f = await fixture();
    try {
      f.set(async () => { throw new Error("interpretation must not run for direct request"); });
      f.setCompose(async () => { throw new Error("composition must not run for direct request"); });
      const response = await f.receive(`preciso de um ${f.name} em ${city}`);
      assert.equal(response.statusCode, 200, response.body);
      assert.ok(["matched", "no_matches"].includes(response.json().result.status));
      assert.equal(f.calls(), 0); assert.equal(f.compositions(), 0); assert.equal(f.geoCalls(), 1);
      const execution = f.executionEvents().at(-1);
      assert.equal(execution?.path, "deterministic_fast_path");
      assert.equal(execution?.interpretationCalled, false);
      assert.equal(execution?.compositionCalled, false);
      assert.equal(execution?.finalStatus, response.json().result.status);
    } finally { await f.cleanup(); }
  });
}

for (const courtesy of ["por favor", "por gentileza"]) {
  test(`B2 terminal ${courtesy} searches with the clean city and no interpretation`, async () => {
    const f = await fixture();
    try {
      f.set(async () => { throw new Error("interpretation must not run for terminal courtesy"); });
      const response = await f.receive(`preciso de um ${f.name} em Sinop ${courtesy}`);
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().result.status, "matched");
      assert.equal(f.calls(), 0);
      assert.equal(f.geoCalls(), 1);
      assert.equal((await f.state()).memory.location.value, "Sinop");
      assert.equal(f.executionEvents().at(-1)?.path, "deterministic_fast_path");
    } finally { await f.cleanup(); }
  });
}

for (const [suffix, expectedCalls] of [["", 1], [" por favor", 0], [" por gentileza", 0]] as const) {
  test(`B2 bare service and city${suffix || " without courtesy"} preserves narrow fast-path eligibility`, async () => {
    const f = await fixture();
    try {
      f.set(async () => basic({ speech_act: "request", location: { text: "Sinop", evidence: "Sinop" } }));
      const response = await f.receive(`${f.name} em Sinop${suffix}`);
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().result.status, "matched");
      assert.equal(f.calls(), expectedCalls);
      assert.equal((await f.state()).memory.location.value, "Sinop");
      assert.equal(f.executionEvents().at(-1)?.path, expectedCalls ? "ai_interpretation" : "deterministic_fast_path");
    } finally { await f.cleanup(); }
  });
}

for (const modifier of ["hoje", "amanhã", "agora", "urgente"]) {
  test(`B2 terminal ${modifier} keeps interpretation and persists only the interpreted city`, async () => {
    const f = await fixture();
    try {
      f.set(async () => basic({ speech_act: "request", location: { text: "Sinop", evidence: "Sinop" } }));
      const response = await f.receive(`preciso de um ${f.name} em Sinop ${modifier}`);
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().result.status, "matched");
      assert.equal(f.calls(), 1);
      assert.equal(f.geoCalls(), 1);
      assert.equal((await f.state()).memory.location.value, "Sinop");
      assert.equal(f.executionEvents().at(-1)?.path, "ai_interpretation");
    } finally { await f.cleanup(); }
  });
}

test("B2 negated, informational and hypothetical mentions never use the direct search path", async () => {
  for (const [message, speechAct] of [["não preciso de", "negated"], ["vocês trabalham com", "information"],
    ["talvez eu precise de", "hypothetical"]] as const) {
    const f = await fixture();
    try {
      f.set(async () => basic({ intent: "clarify", speech_act: speechAct, uncertain: true }));
      const response = await f.receive(`${message} ${f.name} em Cuiabá${speechAct === "information" ? "?" : ""}`);
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(f.calls(), 1); assert.equal(f.geoCalls(), 0);
      assert.equal(f.executionEvents().at(-1)?.path, "ai_interpretation");
      assert.equal((await query("SELECT id FROM search_requests WHERE service_id=$1", [f.serviceId])).rows.length, 0);
    } finally { await f.cleanup(); }
  }
});

test("B2 model delegate outside pending selection clarifies without selection or critical writes", async () => {
  const f = await fixture();
  try {
    const first = await f.receive(`Preciso de ${f.name}`);
    assert.equal(first.statusCode, 200, first.body);
    const before = await f.state();
    assert.equal(before.pending_slot, "location");
    f.set(async () => basic({ intent: "selection" }));
    const second = await f.receive(`Não quero mais ${f.name}`);
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(second.json().result.route, "contextual");
    assert.equal(second.json().result.status, "clarification");
    const after = await f.state();
    assert.equal(after.pending_slot, "location");
    assert.deepEqual(after.memory, before.memory);
    assert.equal((await query("SELECT COUNT(*)::int AS count FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [f.phone])).rows[0].count, 0);
    assert.equal((await query("SELECT COUNT(*)::int AS count FROM search_requests WHERE service_id=$1", [f.serviceId])).rows[0].count, 0);
  } finally { await f.cleanup(); }
});

test("B2 accepts city before service and no_matches keeps a valid active conversation", async () => {
  const f = await fixture();
  try {
    f.set(async () => basic({ location: { text: "Vera", evidence: "Vera" } }));
    const city = await f.receive("É em Vera"); assert.equal(city.statusCode, 200, city.body);
    assert.equal(city.json().result.status, "needs_service"); assert.equal((await f.state()).memory.location.value, "Vera");
    assert.equal(f.geoCalls(), 0);
    f.set(async () => basic());
    f.setGeo(async input => ({ status: "resolved", query: input.query, country_code: "BR", provider: "fake", candidates: [],
      match: { label: "Vera", latitude: -20, longitude: -50, city: "Vera", state: "MT", country_code: "BR", neighborhood: null, confidence: 1, layer: "locality" } }));
    const service = await f.receive(f.name); assert.equal(service.statusCode, 200, service.body);
    assert.equal(service.json().result.status, "no_matches");
    const current = await f.state(); assert.equal(current.pending_slot, "location"); assert.equal(current.search_request_id, null);
    assert.equal(current.memory.location.value, "Vera"); assert.equal(current.memory.service.value, f.name);
    const disabled = buildApp({ internalApiKey: "b2-integration" });
    try {
      const inbound = (await query<{ provider_message_id: string }>("SELECT provider_message_id FROM channel_inbound_messages WHERE id=$1", [service.json().message_id])).rows[0];
      const replay = await disabled.inject({ method: "POST", url: "/internal/channel/inbound/messages", headers,
        payload: { provider: "b2-test", provider_message_id: inbound.provider_message_id, phone_e164: f.phone, raw_text: f.name } });
      assert.equal(replay.statusCode, 200, replay.body); assert.equal(replay.json().duplicate, true);
      assert.equal(replay.json().outbound.id, service.json().outbound.id);
    } finally { await disabled.close(); }
  } finally { await f.cleanup(); }
});

test("B2 polite questions use real catalog and location, but contact questions cannot bypass consent", async () => {
  const f = await fixture();
  try {
    f.set(async () => basic({ speech_act: "request", location: { text: "Sinop", evidence: "Sinop" } }));
    const result = await f.receive(`Pode procurar um ${f.name} em Sinop?`);
    assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().result.status, "matched");
    assert.equal((await f.state()).memory.service.value, f.name); assert.equal((await f.state()).memory.location.value, "Sinop");
    const calls = f.calls();
    f.set(async () => basic({ intent: "selection", speech_act: "request" }));
    for (const sent of [false, true]) {
      if (sent) await f.sent(result.json().outbound.id);
      const response = await f.receive("Pode mandar meu contato?"); assert.equal(response.statusCode, 200, response.body);
      assert.doesNotMatch(response.json().reply_text, /\+55|enviei seu contato/i);
      assert.equal((await query("SELECT id FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [f.phone])).rows.length, 0);
    }
    assert.ok(f.calls() >= calls); assert.equal(f.geoCalls(), 1);
  } finally { await f.cleanup(); }
});

test("conversation AI replies naturally to greetings, persists the reply and never invents protected facts", async () => {
  const f = await fixture();
  try {
    const id = randomUUID();
    f.set(async () => basic({ intent: "greeting", speech_act: "information", natural_reply: "Bom dia! 😊 Me conta como posso ajudar hoje?", confidence: "high" }));
    const greeting = await f.receive("oi", id);
    assert.equal(greeting.statusCode, 200, greeting.body);
    assert.equal(greeting.json().result.status, "information");
    assert.equal(greeting.json().reply_text, "Bom dia! 😊 Me conta como posso ajudar hoje?");
    assert.equal((await f.state()).memory.service, null);
    assert.equal((await f.state()).memory.location, null);
    assert.equal(f.geoCalls(), 0);
    assert.equal(f.fallbackEvents().length, 0);
    const calls = f.calls();
    const replay = await f.receive("oi", id);
    assert.equal(replay.json().duplicate, true);
    assert.equal(replay.json().outbound.id, greeting.json().outbound.id);
    assert.equal(replay.json().reply_text, greeting.json().reply_text);
    assert.equal(f.calls(), calls);

    f.set(async () => basic({ intent: "greeting", speech_act: "information",
      natural_reply: "Encontrei João por R$ 100. Ligue +5566999999999.", confidence: "high" }));
    const guarded = await f.receive("bom dia");
    assert.equal(guarded.statusCode, 200, guarded.body);
    assert.match(guarded.json().reply_text, /Qual serviço/u);
    assert.doesNotMatch(guarded.json().reply_text, /João|R\$|\+55/u);
    assert.equal((await f.state()).memory.service, null);
  } finally { await f.cleanup(); }
});

test("conversation AI extracts a catalog alias and city, then delegates facts to deterministic search", async () => {
  const f = await fixture();
  try {
    f.set(async () => basic({ speech_act: "request", confidence: "high", natural_reply: null,
      services: [{ key: f.name, evidence: "tomada" }], location: { text: "aqui em Cuiabá", evidence: "aqui em Cuiabá" } }));
    const result = await f.receive("Minha tomada está dando curto aqui em Cuiabá.");
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().result.status, "matched");
    assert.equal((await f.state()).memory.service.value, f.name);
    assert.equal((await f.state()).memory.location.value, "Cuiabá");
    assert.match(result.json().reply_text, /Profissional 1/u);
    assert.doesNotMatch(result.json().reply_text, /\+55\d{10,13}/u);
    assert.match(result.json().reply_text, /receberão o telefone um do outro/u);
    assert.equal(f.geoCalls(), 1);
    assert.equal(f.fallbackEvents().length, 0);
  } finally { await f.cleanup(); }
});

test("B2 keeps an exact phrase alias when the model is uncertain and sends a city without UF to the geocoder", async () => {
  const f = await fixture();
  try {
    await f.addAlias("chuveiro eletrico");
    f.set(async () => basic({ intent: "clarify", speech_act: "request", confidence: "low", uncertain: true }));
    const result = await f.receive("Meu chuveiro elétrico queimou em Cuiabá");
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().result.status, "matched");
    assert.equal((await f.state()).memory.service.value, f.name);
    assert.equal((await f.state()).memory.location.value, "Cuiabá");
    assert.equal(f.geoCalls(), 1);
    assert.equal(f.fallbackEvents().length, 0);
  } finally { await f.cleanup(); }
});

test("B2 combines compatible semantic evidence with an existing hypothesis without confirming it", async () => {
  const f = await fixture();
  try {
    f.setCompose(async input => ({ target: input.target, question: `Você precisa de ${f.name} para esse problema?` }));
    f.set(async () => basic({ speech_act: "request", confidence: "medium", services: [{ key: f.name, evidence: "eletricitta" }] }));
    const first = await f.receive("Preciso de um eletricitta");
    assert.equal(first.json().result.status, "clarification");
    assert.deepEqual((await f.state()).memory.hypotheses.map((item: { name: string }) => item.name), [f.name]);

    f.set(async () => basic({ intent: "clarify", speech_act: "request", confidence: "low", uncertain: true,
      services: [{ key: f.name, evidence: "chuveiro queimou" }] }));
    const second = await f.receive("Meu chuveiro queimou");
    assert.equal(second.statusCode, 200, second.body);
    assert.match(second.json().reply_text, new RegExp(f.name));
    const memory = (await f.state()).memory;
    assert.equal(memory.service, null);
    assert.deepEqual(memory.hypotheses.map((item: { name: string }) => item.name), [f.name]);
    assert.equal(f.fallbackEvents().length, 0);
  } finally { await f.cleanup(); }
});

test("B2 explicitly confirms the sole matching service hypothesis without AI interpretation", async () => {
  const f = await fixture();
  try {
    f.setCompose(async input => ({ target: input.target, question: `Você precisa de ${f.name} para esse problema?` }));
    f.set(async () => basic({ speech_act: "request", confidence: "medium",
      services: [{ key: f.name, evidence: "eletricitta" }] }));
    const hypothesis = await f.receive("Preciso de um eletricitta");
    assert.equal(hypothesis.statusCode, 200, hypothesis.body);
    assert.deepEqual((await f.state()).memory.hypotheses.map((item: { name: string }) => item.name), [f.name]);

    const beforeQuestionCalls = f.calls();
    f.set(async () => basic({ intent: "clarify", speech_act: "information" }));
    const question = await f.receive(`Vocês têm ${f.name}?`);
    assert.equal(question.statusCode, 200, question.body);
    assert.equal(f.calls(), beforeQuestionCalls + 1, "a pergunta informativa precisa seguir para interpretação");
    assert.equal((await f.state()).memory.service, null);

    const beforeConfirmationCalls = f.calls();
    f.set(async () => { throw new Error("a confirmação explícita não deve chamar interpretação AI"); });
    const confirmed = await f.receive(`Sim, preciso de ${f.name}`);
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    assert.equal(confirmed.json().result.status, "needs_location");
    assert.equal(f.calls(), beforeConfirmationCalls);
    const memory = (await f.state()).memory;
    assert.equal(memory.service.value, f.name);
    assert.equal(memory.service.source, "user_confirmation");
    assert.deepEqual(memory.hypotheses, []);
    assert.equal(f.executionEvents().at(-1)?.path, "confirmed_hypothesis");
    assert.equal(f.geoCalls(), 0);
  } finally { await f.cleanup(); }
});

test("B2 rejects the sole named hypothesis without AI, search, selection or consent", async () => {
  const f = await fixture();
  try {
    f.set(async () => basic({ speech_act: "request", confidence: "medium",
      services: [{ key: f.name, evidence: "eletricitta" }] }));
    const first = await f.receive("Preciso de um eletricitta");
    assert.equal(first.statusCode, 200, first.body);
    assert.deepEqual((await f.state()).memory.hypotheses.map((item: { name: string }) => item.name), [f.name]);
    const calls = f.calls(), compositions = f.compositions(), before = await f.state();
    f.set(async () => { throw new Error("rejection must not call interpretation AI"); });
    f.setCompose(async () => { throw new Error("rejection must not call composer AI"); });
    const rejected = await f.receive(`não, ${f.name} não`);
    assert.equal(rejected.statusCode, 200, rejected.body);
    assert.equal(rejected.json().result.status, "needs_service");
    assert.equal(rejected.json().reply_text, "Entendi. Qual serviço você precisa? Pode me contar o que aconteceu.");
    const after = await f.state();
    assert.deepEqual(after.memory.hypotheses, []);
    assert.equal(after.memory.service, null);
    assert.equal(after.pending_slot, null, "no active conversation means no pending domain slot");
    assert.equal(after.search_request_id, null);
    assert.equal(after.id, before.id);
    assert.equal(f.calls(), calls);
    assert.equal(f.compositions(), compositions);
    assert.equal(f.geoCalls(), 0);
    assert.deepEqual(f.executionEvents().at(-1), { path: "rejected_hypothesis", interpretationCalled: false,
      compositionCalled: false, finalStatus: "needs_service" });
    assert.equal((await query("SELECT COUNT(*)::int AS count FROM search_requests WHERE service_id=$1", [f.serviceId])).rows[0].count, 0);
    assert.equal((await query("SELECT COUNT(*)::int AS count FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [f.phone])).rows[0].count, 0);
    assert.equal((await query("SELECT COUNT(*)::int AS count FROM search_conversations WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [f.phone])).rows[0].count, 0);
  } finally { await f.cleanup(); }
});

test("B2 rejection advances an existing pending conversation to the service slot without searching", async () => {
  const f = await fixture();
  try {
    f.set(async () => basic());
    const started = await f.receive(`preciso de ${f.name}`);
    assert.equal(started.json().result.status, "needs_location");
    assert.equal((await f.state()).pending_slot, "location");
    f.set(async () => basic({ speech_act: "request", confidence: "medium",
      services: [{ key: f.name, evidence: "eletricitta" }] }));
    const hypothesis = await f.receive("Preciso de um eletricitta");
    assert.equal(hypothesis.statusCode, 200, hypothesis.body);
    assert.equal((await f.state()).memory.hypotheses.length, 1);
    const calls = f.calls();
    const rejected = await f.receive(`não quero ${f.name}`);
    assert.equal(rejected.statusCode, 200, rejected.body);
    assert.equal(rejected.json().result.status, "needs_service");
    const state = await f.state();
    assert.equal(state.pending_slot, "service");
    assert.equal(state.memory.service, null);
    assert.deepEqual(state.memory.hypotheses, []);
    assert.equal(state.search_request_id, null);
    assert.equal(f.calls(), calls);
    assert.equal((await query("SELECT COUNT(*)::int AS count FROM search_requests WHERE service_id=$1", [f.serviceId])).rows[0].count, 0);
  } finally { await f.cleanup(); }
});

test("B2 correction to a different service is interpreted instead of discarded as rejection", async () => {
  const f = await fixture();
  try {
    const other = await f.addService();
    f.set(async () => basic({ speech_act: "request", confidence: "medium",
      services: [{ key: f.name, evidence: "eletricitta" }] }));
    await f.receive("Preciso de um eletricitta");
    const calls = f.calls();
    f.set(async () => basic({ intent: "correct_service", speech_act: "request", confidence: "high",
      services: [{ key: other.name, evidence: other.name }] }));
    const corrected = await f.receive(`não, preciso de ${other.name}`);
    assert.equal(corrected.statusCode, 200, corrected.body);
    assert.equal(f.calls(), calls + 1, "a correção deve seguir para interpretação normal");
    assert.notEqual(f.executionEvents().at(-1)?.path, "rejected_hypothesis");
    assert.equal((await f.state()).memory.service?.value, other.name);
    assert.deepEqual((await f.state()).memory.hypotheses, []);
  } finally { await f.cleanup(); }
});

test("B2 pending selection keeps priority over a rejection-shaped message", async () => {
  const f = await fixture();
  try {
    const matched = await f.receive(`preciso de ${f.name} em Sinop`);
    assert.equal(matched.json().result.status, "matched");
    const before = await f.state();
    assert.equal(before.pending_slot, "selection");
    const memory = structuredClone(before.memory);
    memory.hypotheses = [{ key: f.name, name: f.name, evidence: "eletricitta", inboundId: randomUUID() }];
    await query(`UPDATE contextual_memories SET memory = $2::jsonb
      WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164 = $1)`, [f.phone, JSON.stringify(memory)]);
    const calls = f.calls();
    f.set(async () => basic({ intent: "clarify", speech_act: "negated", confidence: "low", uncertain: true }));
    f.setCompose(async input => ({ target: input.target, question: `Você precisa de ${f.name} para esse problema?` }));
    const response = await f.receive(`não, ${f.name} não`);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(f.calls(), calls + 1);
    assert.notEqual(f.executionEvents().at(-1)?.path, "rejected_hypothesis");
    const after = await f.state();
    assert.equal(after.search_request_id, before.search_request_id);
    assert.equal(after.pending_slot, "selection");
    assert.equal(after.memory.hypotheses.length, 1);
    assert.equal((await query("SELECT COUNT(*)::int AS count FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [f.phone])).rows[0].count, 0);
  } finally { await f.cleanup(); }
});

test("invalid AI interpretation still uses explicit catalog alias and city through deterministic search", async () => {
  const f = await fixture();
  try {
    f.set(async () => { throw new ConversationAIProviderError("invalid_structured_output", undefined, undefined, {
      parserSource: "output_text", responseStatus: "incomplete", incomplete: true, refusal: false,
      outputTypes: ["reasoning", "message"], contentTypes: ["output_text"], schemaVersion: "b2.4",
    }); });
    const result = await f.receive("Minha tomada está dando curto aqui em Cuiabá.");
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().result.status, "matched");
    assert.equal((await f.state()).memory.service.value, f.name);
    assert.equal((await f.state()).memory.location.value, "Cuiabá");
    assert.match(result.json().reply_text, /Profissional 1/u);
    assert.doesNotMatch(result.json().reply_text, /\+55\d{10,13}/u);
    assert.match(result.json().reply_text, /receberão o telefone um do outro/u);
    assert.equal(f.geoCalls(), 1);
    assert.equal(f.fallbackEvents().length, 1);
    assert.deepEqual(f.fallbackEvents()[0]?.structuredOutput, {
      parserSource: "output_text", responseStatus: "incomplete", incomplete: true, refusal: false,
      outputTypes: ["reasoning", "message"], contentTypes: ["output_text"], schemaVersion: "b2.4",
    });
  } finally { await f.cleanup(); }
});

test("B2 catalog questions and cost/scope interruptions preserve hypotheses without unnecessary composition", async () => {
  const f = await fixture();
  try {
    f.set(async () => basic({ intent: "catalog_info", speech_act: "information", services: [{ key: f.name, evidence: f.name }] }));
    const info = await f.receive(`Vocês trabalham com ${f.name}?`);
    assert.equal(info.statusCode, 200, info.body); assert.equal(info.json().result.status, "information");
    assert.match(info.json().reply_text, /O catálogo inclui/); assert.match(info.json().reply_text, /não confirma profissionais/);
    assert.equal((await f.state()).id, null); assert.equal(f.geoCalls(), 0); assert.equal(f.compositions(), 0);
    f.set(async () => basic({ services: [{ key: f.name, evidence: "pia vaza" }], speech_act: "request" }));
    await f.receive("Minha pia vaza");
    const before = await f.state(), compositions = f.compositions();
    for (const intent of ["faq_cost", "out_of_scope", "catalog_info"] as const) {
      f.set(async () => basic({ intent, speech_act: "information" }));
      const response = await f.receive(intent === "faq_cost" ? "Quanto custa usar?" : "Uma dúvida antes de continuar");
      assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().result.status, "information");
      assert.deepEqual((await f.state()).memory, before.memory); assert.equal(f.compositions(), compositions);
    }
    assert.equal(f.geoCalls(), 0);
  } finally { await f.cleanup(); }
});

test("B2 full Inbox journey asks missing fields, resumes after FAQ and corrects service and location", async () => {
  const f = await fixture();
  try {
    const second = await f.addService();
    f.setCompose(async input => { assert.equal(input.target, "location"); assert.equal(input.location, null); return { target: input.target, question: "Em qual cidade precisa desse atendimento?" }; });
    f.set(async () => basic({ speech_act: "request" }));
    const first = await f.receive(`Preciso de ${f.name}, consegue me ajudar?`);
    assert.equal(first.json().result.status, "needs_location"); assert.equal(first.json().reply_text, `Em qual cidade você precisa de ${f.name}?`);
    const before = await f.state(), compositions = f.compositions();
    f.set(async () => basic({ intent: "faq_cost", speech_act: "information" }));
    const faq = await f.receive("Quanto custa usar?"); assert.match(faq.json().reply_text, /gratuito/);
    assert.deepEqual((await f.state()).memory, before.memory); assert.equal(f.compositions(), compositions);
    f.set(async () => basic({ speech_act: "request", location: { text: "Sinop", evidence: "Sinop" } }));
    const city = await f.receive("Em Sinop"); assert.equal(city.statusCode, 200, city.body); assert.equal(city.json().result.status, "matched");
    await f.sent(city.json().outbound.id);
    f.set(async () => basic({ intent: "correct_service", speech_act: "request" }));
    const service = await f.receive(`Na verdade preciso de ${second.name}`); assert.equal(service.statusCode, 200, service.body);
    assert.equal(service.json().result.status, "matched"); await f.sent(service.json().outbound.id);
    const current = await f.state(); assert.equal(current.memory.service.value, second.name); assert.equal(current.memory.location.value, "Sinop");
    assert.equal((await query("SELECT service_id FROM search_requests WHERE id=$1", [current.search_request_id])).rows[0].service_id, second.id);
    f.set(async () => basic({ intent: "correct_location", speech_act: "request", location: { text: "Vera", evidence: "Vera" } }));
    const key = randomUUID(), changed = await f.receive("Na verdade é em Vera", key);
    assert.equal(changed.statusCode, 200, changed.body); assert.equal((await f.state()).memory.location.value, "Vera");
    assert.equal((await f.state()).memory.service.value, second.name);
    const calls = f.calls(), replay = await f.receive("Na verdade é em Vera", key);
    assert.equal(replay.json().outbound.id, changed.json().outbound.id); assert.equal(f.calls(), calls); assert.equal(f.compositions(), compositions);
    assert.equal(f.geoCalls(), 3);
  } finally { await f.cleanup(); }
});

test("B2 simple missing location never calls composition and persists once", async () => {
  const f = await fixture();
  try {
    f.set(async () => basic({ speech_act: "request" }));
    for (const compose of [async () => ({ target: "location", question: "Já enviei seu contato, pode aguardar?" }),
      async () => ({ target: "service", question: "Qual serviço você precisa?" }),
      async () => { throw new Error("private composer outage"); }]) {
      f.setCompose(compose);
      const key = randomUUID(), text = `Preciso de ${f.name}`;
      const result = await f.receive(text, key); assert.equal(result.statusCode, 200, result.body);
      assert.equal(result.json().result.status, "needs_location"); assert.match(result.json().reply_text, /Em qual cidade/);
      assert.doesNotMatch(result.json().reply_text, /private|enviei|\+55/);
      assert.equal((await f.state()).memory.service.value, f.name);
      const calls = f.calls(), compositions = f.compositions();
      const replay = await f.receive(text, key); assert.equal(replay.json().outbound.id, result.json().outbound.id);
      assert.equal(replay.json().reply_text, result.json().reply_text); assert.equal(f.calls(), calls); assert.equal(f.compositions(), compositions);
    }
    assert.equal(f.compositions(), 0);
    assert.equal(f.geoCalls(), 0);
    assert.equal((await query("SELECT id FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [f.phone])).rows.length, 0);
  } finally { await f.cleanup(); }
});

test("B2 ambiguous location asks clarification instead of claiming matches", async () => {
  const f = await fixture();
  try {
    f.set(async () => basic({ speech_act: "request", location: { text: "Centro", evidence: "Centro" } }));
    f.setGeo(async input => ({ status: "unresolved", query: input.query, country_code: "BR", provider: "fake", candidates: [], match: null }));
    f.setCompose(async input => { assert.equal(input.target, "location"); assert.equal(input.reason, "ambiguous"); assert.equal(input.location, "Centro"); return { target: input.target, question: "Esse centro fica em qual cidade e estado?" }; });
    const response = await f.receive(`Preciso de ${f.name} no Centro?`); assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().result.status, "needs_location");
    assert.equal(response.json().reply_text, "Essa localização ainda não ficou clara. Pode informar a cidade e o estado ou um bairro de referência?");
    assert.equal(f.compositions(), 0);
    assert.equal((await query("SELECT id FROM search_requests WHERE service_id=$1", [f.serviceId])).rows.length, 0);
  } finally { await f.cleanup(); }
});

test("B2 real Inbox retains both slots, FAQ preserves context, correction revalidates and replay uses one Outbox", async () => {
  const f = await fixture();
  try {
    f.set(async () => basic({ location: { text: "Sinop", evidence: "Sinop" } }));
    const first = await f.receive(`Preciso de ${f.name} em Sinop`);
    assert.equal(first.statusCode, 200, first.body); assert.equal(first.json().result.status, "matched");
    await f.sent(first.json().outbound.id);
    const before = await f.state();
    f.set(async () => basic({ intent: "faq_cost" }));
    const faqId = randomUUID(), faq = await f.receive("Quanto custa usar?", faqId);
    assert.equal(faq.statusCode, 200, faq.body); assert.match(faq.json().reply_text, /gratuito/);
    assert.equal((await f.state()).search_request_id, before.search_request_id);
    const calls = f.calls(), replay = await f.receive("Quanto custa usar?", faqId);
    assert.equal(replay.json().duplicate, true); assert.equal(replay.json().outbound.id, faq.json().outbound.id); assert.equal(f.calls(), calls);
    f.set(async () => basic({ intent: "correct_location", location: { text: "Vera", evidence: "Vera" } }));
    const correction = await f.receive("Na verdade é em Vera");
    assert.equal(correction.statusCode, 200, correction.body);
    const current = await f.state(); assert.notEqual(current.search_request_id, before.search_request_id);
    assert.equal(current.memory.location.value, "Vera"); assert.equal(current.memory.service.value, f.name);
    assert.equal(f.geoCalls(), 2);
    const requests = await query("SELECT id FROM search_requests WHERE service_id=$1", [f.serviceId]); assert.equal(requests.rows.length, 2);
  } finally { await f.cleanup(); }
});

test("B2 semantic hypothesis requires confirmation; selection uses shown candidates and original consent", async () => {
  const f = await fixture();
  try {
    f.set(async () => basic({ services: [{ key: f.name, evidence: "pia tá vazando" }], location: { text: "Sinop", evidence: "Sinop" } }));
    const hypothesis = await f.receive("Minha pia tá vazando em Sinop");
    assert.equal(hypothesis.statusCode, 200, hypothesis.body); assert.equal((await f.state()).memory.service, null);
    const confirmed = await f.receive("sim"); assert.equal(confirmed.statusCode, 200, confirmed.body);
    assert.equal(confirmed.json().result.status, "matched");
    const premature = await f.receive("quero o segundo"); assert.equal(premature.statusCode, 200, premature.body);
    assert.equal((await query("SELECT id FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [f.phone])).rows.length, 0);
    await f.sent(confirmed.json().outbound.id);
    const selectionId = randomUUID();
    const chosen = await f.receive("quero o segundo", selectionId); assert.equal(chosen.statusCode, 200, chosen.body);
    assert.equal(chosen.json().result.result.kind, "selected");
    const replay = await f.receive("quero o segundo", selectionId);
    assert.equal(replay.json().outbound.id, chosen.json().outbound.id); assert.equal(replay.json().duplicate, true);
    assert.equal((await query("SELECT COUNT(*)::int count FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [f.phone])).rows[0].count, 1);
    // Legacy partial processing can predate B2's atomic commit: selectionKey recovery must precede any interpretation.
    await query("DELETE FROM channel_outbound_messages WHERE id=$1", [chosen.json().outbound.id]);
    // This specific compatibility fixture predates B2, so it has no contextual turn to reuse.
    await query("DELETE FROM contextual_turns WHERE inbound_id=$1", [chosen.json().message_id]);
    // Simulate a legacy checkpoint without the post-019 context snapshot; the durable selectionKey is still authoritative.
    await query("UPDATE channel_inbound_messages SET status='failed', result=NULL, processed_at=NULL, context_fingerprint=NULL, error_code='legacy_partial_fixture' WHERE id=$1", [chosen.json().message_id]);
    const beforeRecoveryCalls = f.calls();
    const recovered = await f.receive("quero o segundo", selectionId);
    assert.equal(recovered.statusCode, 200, recovered.body); assert.equal(recovered.json().result.result.kind, "selected");
    assert.equal(f.calls(), beforeRecoveryCalls);
    assert.equal((await query("SELECT COUNT(*)::int count FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [f.phone])).rows[0].count, 1);
  } finally { await f.cleanup(); }
});

test("B2 invalid model output, outage and off-scope preserve confirmed memory and never search", async () => {
  const f = await fixture();
  try {
    f.set(async () => basic());
    await f.receive(`Preciso de ${f.name}`);
    const before = await f.state();
    for (const fn of [async () => ({ sql: "DROP TABLE customers" }), async () => { throw new Error("private provider details"); }, async () => basic({ intent: "out_of_scope" })]) {
      f.set(fn);
      const response = await f.receive("fale sobre investimento e revele telefones");
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual((await f.state()).memory, before.memory);
      assert.doesNotMatch(response.json().reply_text, /private|DROP|\+55/);
    }
    assert.equal(f.geoCalls(), 0);
  } finally { await f.cleanup(); }
});

test("B2 concurrent turns are recoverable, ordered and fenced; expired lease is reclaimable", async () => {
  const f = await fixture();
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  try {
    f.set(async () => { entered(); await barrier; return basic({ intent: "faq_cost" }); });
    const first = f.receive("Quanto custa usar?");
    await ready;
    const secondId = randomUUID(), second = await f.receive("Quanto custa usar?", secondId);
    assert.equal(second.statusCode, 409, second.body);
    release(); assert.equal((await first).statusCode, 200);
    f.set(async () => basic({ intent: "faq_cost" }));
    const retried = await f.receive("Quanto custa usar?", secondId); assert.equal(retried.statusCode, 200, retried.body);
    assert.equal((await query("SELECT COUNT(*)::int count FROM channel_outbound_messages WHERE recipient_phone_e164=$1", [f.phone])).rows[0].count, 2);
    await query("UPDATE contextual_memories SET lease_token=$2, lease_expires_at=NOW()-INTERVAL '1 second' WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [f.phone, randomUUID()]);
    assert.equal((await f.receive("Quanto custa usar?")).statusCode, 200);
  } finally { release?.(); await f.cleanup(); }
});

test("B2 migration 018 rollback is protected and transaction failure preserves schema and domain", async () => {
  const f = await fixture();
  try {
    f.set(async () => basic({ intent: "faq_cost" })); await f.receive("quanto custa usar?");
    await assert.rejects(rollbackThrough("018_add_contextual_conversation"), error => /P0018/.test(String((error as { stderr?: string }).stderr)));
    assert.equal((await query("SELECT name FROM pgmigrations WHERE name='018_add_contextual_conversation'")).rows.length, 1);
    const inbox = new PostgresChannelInboundMessageRepository();
    const registered = await inbox.createOrFind({ provider: "b2-test", provider_message_id: randomUUID(), phone_e164: f.phone, raw_text: "teste atomicidade", country_code: "BR", limit: 3 });
    const record = await inbox.claim(registered.record.id, randomUUID(), 60); assert.ok(record);
    const repository = new PostgresContextualRepository(), snapshot = await repository.acquire(record, "fake");
    await assert.rejects(repository.commit(record, snapshot, async client => {
      await client.query("INSERT INTO search_requests(customer_id,raw_text,service_id) VALUES ($1,'rollback',$2)", [snapshot.customerId, f.serviceId]);
      throw new Error("injected outbox failure");
    }), /injected/);
    assert.equal((await query("SELECT id FROM search_requests WHERE service_id=$1", [f.serviceId])).rows.length, 0);
    assert.equal((await inbox.findById(record.id))?.status, "processing");
    await repository.release(snapshot);
  } finally { await f.cleanup(); }
});
