import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rollbackThrough } from "./rollback-helper.js";
import { deliverClaim } from "./delivery-helper.js";
import { after, test } from "node:test";
import { channelInboundMessageResponseSchema } from "@contatocerto/shared";
import { buildApp } from "../src/app.js";
import { closeDatabaseConnection, query, withTransaction } from "../src/database/connection.js";
import { BILATERAL_NOTICE, BILATERAL_NOTICE_VERSION, createOpportunityCode } from "../src/modules/bilateral-contact/bilateral-contact.policy.js";
import { PostgresSearchConversationRepository } from "../src/modules/search-conversations/search-conversation.repository.js";
import { PostgresSelectionMatchRepository } from "../src/modules/match-selection/match-selection.repository.js";
import { PostgresChannelOutboundMessageRepository } from "../src/modules/channel-outbox/channel-outbox.repository.js";

after(closeDatabaseConnection);
const key = "opportunity-integration";
const phone = () => `+5566${Math.floor(100000000 + Math.random() * 899999999)}`;

test("professional acceptance acts as optional acknowledgement: friendly reply to professional, no status change, no customer outbound", async () => {
  const f = await fixture();
  try {
    const decisionId = randomUUID();
    const accepted = await f.send(`aceito ${f.code}`, f.professionalPhone, decisionId);
    assert.equal(accepted.result.result.kind, "acknowledged");
    const reply = await deliverClaim(f.app, key, "test", accepted.outbound.id);
    assert.equal(reply.purpose, "professional_reply");
    assert.equal(reply.recipient_phone_e164, f.professionalPhone);
    assert.equal(reply.text_content, "Tudo certo. O contato já foi compartilhado com o cliente.");
    // No customer outbound notification in v2
    assert.equal((await new PostgresChannelOutboundMessageRepository().claimNextPending(randomUUID(), 60)), null);
    const repeat = await f.send(`aceito ${f.code}`, f.professionalPhone, decisionId);
    assert.equal(repeat.outbound.id, reply.id);
    assert.equal(repeat.outbound.status, "sent");
    assert.equal(await f.countEvents(), 0);
    assert.equal(await f.countUnavailabilityEvents(), 0);
    const contact = (await query<{ status: string }>("SELECT status FROM contacts WHERE id = $1", [f.contactId])).rows[0];
    assert.equal(contact.status, "shared");
  } finally { await f.cleanup(); }
});

async function fixture(other = false) {
  const customerId = randomUUID(), professionalId = randomUUID(), searchId = randomUUID(), conversationId = randomUUID();
  const contactId = randomUUID(), choiceId = randomUUID(), otherId = randomUUID(), code = createOpportunityCode();
  const customerPhone = phone(), professionalPhone = phone();
  const app = buildApp({ internalApiKey: key });
  await query("INSERT INTO customers (id, phone_e164) VALUES ($1, $2)", [customerId, customerPhone]);
  await query("INSERT INTO professionals (id, display_name, slug, phone_e164, status) VALUES ($1::uuid, 'Ana', $1::text, $2, 'active')", [professionalId, professionalPhone]);
  await query("INSERT INTO search_requests (id, customer_id, raw_text, status) VALUES ($1, $2, 'eletricista em Sinop', 'selected')", [searchId, customerId]);
  await query(`INSERT INTO search_conversations (id, customer_id, status, original_raw_text, service_text, location_text,
    country_code, limit_value, search_request_id, expires_at, completed_at)
    VALUES ($1, $2, 'completed', 'eletricista em Sinop', 'eletricista', 'Sinop, MT', 'BR', 3, $3, NOW() + INTERVAL '1 hour', NOW())`, [conversationId, customerId, searchId]);
  await query(`INSERT INTO channel_inbound_messages (id, provider, provider_message_id, phone_e164, raw_text, country_code, limit_value)
    VALUES ($1::uuid, 'test', $1::text, $2, 'Ana', 'BR', 3)`, [choiceId, customerPhone]);
  await query(`UPDATE channel_inbound_messages SET status='processed',processed_at=NOW(),
    result=jsonb_build_object('route','selection','customer_id',$2::uuid,'result',jsonb_build_object('kind','selected','professional_name','Ana','service_name','eletricista','professional_phone_e164',$3::text)) WHERE id=$1`,[choiceId,customerId,professionalPhone]);
  const snapshot = { public_code: code, service_name: "eletricista", city: "Sinop", state: "MT", neighborhood: null,
    summary: "Reparar tomada", professional_name: "Ana", professional_phone_e164: professionalPhone,
    customer_phone_e164: customerPhone, notice_version: "bilateral-v1", notice_outbound_id: randomUUID(),
    notice_sent_at: new Date().toISOString(), choice_inbound_id: choiceId, chosen_at: new Date().toISOString(),
    consented_at: new Date().toISOString(), consent_method: "selection_after_notice" };
  await query(`INSERT INTO contacts (id, professional_id, customer_id, search_request_id, selection_key,
    public_code, bilateral_snapshot, selection_conversation_id, status) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8, 'shared')`,
  [contactId, professionalId, customerId, searchId, choiceId, code, JSON.stringify(snapshot), conversationId]);
  if (other) await query(`INSERT INTO search_conversations (id, customer_id, status, pending_slot, original_raw_text,
    service_text, country_code, limit_value, expires_at) VALUES ($1,$2,'active','location','encanador','encanador','BR',3,NOW()+INTERVAL '1 hour')`, [otherId, customerId]);
  async function send(text: string, sender = professionalPhone, id = randomUUID()) {
    const response = await app.inject({ method: "POST", url: "/internal/channel/inbound/messages",
      headers: { "x-internal-key": key }, payload: { provider: "test", provider_message_id: id, phone_e164: sender, raw_text: text, country_code: "BR", limit: 3 } });
    assert.equal(response.statusCode, 200, `Inbox failed with ${response.statusCode}`);
    return channelInboundMessageResponseSchema.parse(response.json());
  }
  async function concurrentDecisions(texts: string[]) {
    const deliveries = texts.map(raw_text => ({ provider: "test", provider_message_id: randomUUID(), phone_e164: professionalPhone, raw_text, country_code: "BR", limit: 3 }));
    const responses = await Promise.all(deliveries.map(payload => app.inject({ method: "POST", url: "/internal/channel/inbound/messages", headers: { "x-internal-key": key }, payload })));
    assert.ok(responses.some(response => response.statusCode === 200));
    for (const response of responses) {
      assert.ok([200, 409].includes(response.statusCode), response.body);
      if (response.statusCode === 409) assert.equal(response.json().error, "channel_message_processing");
    }
    // FIFO can queue the later delivery. Complete it through the real autonomous consumer, not by bypassing its claim.
    for (const response of responses.filter(response => response.statusCode === 409)) {
      assert.equal(response.json().error, "channel_message_processing");
      const recovered = await app.inject({ method: "POST", url: "/internal/channel/inbound/next/process", headers: { "x-internal-key": key } });
      assert.equal(recovered.statusCode, 200, recovered.body);
      assert.equal(recovered.json().status, "processed");
    }
    const replayed = await Promise.all(deliveries.map(payload => send(payload.raw_text, professionalPhone, payload.provider_message_id)));
    assert.ok(replayed.every(response => response.duplicate));
    return replayed;
  }
  const conversations = async () => (await query<{ id: string; status: string; resume_slot: string | null }>(
    "SELECT id, status, resume_slot FROM search_conversations WHERE customer_id=$1 ORDER BY id", [customerId])).rows;
  const countEvents = async () => Number((await query("SELECT count(*) FROM opportunity_response_events WHERE contact_id=$1", [contactId])).rows[0].count);
  const countUnavailabilityEvents = async () => Number((await query("SELECT count(*) FROM professional_unavailability_events WHERE contact_id=$1", [contactId])).rows[0].count);
  async function cleanup() {
    await app.close();
    await withTransaction(async (db) => {
      await db.query("UPDATE channel_inbound_messages SET response_outbound_id=NULL WHERE phone_e164 IN ($1,$2)", [customerPhone, professionalPhone]);
      await db.query("DELETE FROM channel_outbound_messages WHERE recipient_phone_e164 IN ($1,$2)", [customerPhone, professionalPhone]);
      // Fixture teardown only; production never bypasses the append-only guard.
      await db.query("ALTER TABLE professional_unavailability_events DISABLE TRIGGER professional_unavailability_events_immutable");
      await db.query("DELETE FROM professional_unavailability_events WHERE contact_id IN (SELECT id FROM contacts WHERE customer_id=$1)", [customerId]);
      await db.query("ALTER TABLE professional_unavailability_events ENABLE TRIGGER professional_unavailability_events_immutable");
      await db.query("ALTER TABLE opportunity_response_events DISABLE TRIGGER opportunity_event_immutable");
      await db.query("DELETE FROM opportunity_response_events WHERE contact_id IN (SELECT id FROM contacts WHERE customer_id=$1)", [customerId]);
      await db.query("ALTER TABLE opportunity_response_events ENABLE TRIGGER opportunity_event_immutable");
      await db.query("DELETE FROM channel_inbound_recovery_events WHERE inbound_id IN (SELECT id FROM channel_inbound_messages WHERE phone_e164 IN ($1,$2))", [customerPhone, professionalPhone]);
      await db.query("DELETE FROM channel_inbound_messages WHERE phone_e164 IN ($1,$2)", [customerPhone, professionalPhone]);
      await db.query("DELETE FROM contacts WHERE customer_id=$1", [customerId]);
      await db.query("DELETE FROM matches WHERE search_request_id IN (SELECT id FROM search_requests WHERE customer_id=$1)", [customerId]);
      await db.query("DELETE FROM search_conversations WHERE customer_id=$1", [customerId]);
      await db.query("DELETE FROM search_requests WHERE customer_id=$1", [customerId]);
      await db.query("DELETE FROM professionals WHERE id=$1", [professionalId]);
      await db.query("DELETE FROM customers WHERE id=$1", [customerId]);
    });
  }
  async function addOpportunity() {
    const search = randomUUID(), conversation = randomUUID(), publicCode = createOpportunityCode(), selectionKey = randomUUID();
    await query("INSERT INTO search_requests (id,customer_id,raw_text,status) VALUES ($1,$2,'eletricista','selected')", [search,customerId]);
    await query(`INSERT INTO search_conversations (id,customer_id,status,original_raw_text,service_text,country_code,limit_value,search_request_id,expires_at,completed_at)
      VALUES ($1,$2,'completed','eletricista','eletricista','BR',3,$3,NOW()+INTERVAL '1 hour',NOW())`, [conversation,customerId,search]);
    await query(`INSERT INTO channel_inbound_messages (id,provider,provider_message_id,phone_e164,raw_text,country_code,limit_value)
      VALUES ($1::uuid,'test',$1::text,$2,'Ana','BR',3)`,[selectionKey,customerPhone]);
    await query(`UPDATE channel_inbound_messages SET status='processed',processed_at=NOW(),
      result=jsonb_build_object('route','selection','customer_id',$2::uuid,'result',jsonb_build_object('kind','selected','professional_name','Ana','service_name','eletricista','professional_phone_e164',$3::text)) WHERE id=$1`,[selectionKey,customerId,professionalPhone]);
    await query(`INSERT INTO contacts (professional_id,customer_id,search_request_id,selection_key,public_code,bilateral_snapshot,selection_conversation_id, status)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7, 'shared')`, [professionalId,customerId,search,selectionKey,publicCode,JSON.stringify({...snapshot,public_code:publicCode,choice_inbound_id:selectionKey}),conversation]);
    return { conversation, publicCode };
  }
  return { app, choiceId, customerId, contactId, professionalId, searchId, conversationId, otherId, code, customerPhone, professionalPhone, send, concurrentDecisions, conversations, countEvents, countUnavailabilityEvents, cleanup, addOpportunity };
}

test("decline reopens without another active search; events, replies and replay are atomic", async () => {
  const f = await fixture();
  try {
    const id = randomUUID();
    const first = await f.send(`recuso ${f.code}`, f.professionalPhone, id);
    assert.equal(first.result.route, "opportunity");
    assert.equal(first.result.result.kind, "unavailability_declared");
    assert.deepEqual(await f.conversations(), [{ id: f.conversationId, status: "active", resume_slot: null }]);
    assert.equal(await f.countUnavailabilityEvents(), 1);
    const replay = await f.send(`recuso ${f.code}`, f.professionalPhone, id);
    assert.equal(replay.duplicate, true);
    assert.deepEqual(replay.outbound, first.outbound);
    const repeat = await f.send(`aceito ${f.code}`);
    assert.deepEqual(repeat.outbound, first.outbound);
    assert.equal(await f.countUnavailabilityEvents(), 1);
    const rows = (await query("SELECT purpose FROM channel_outbound_messages WHERE professional_unavailability_event_id IN (SELECT id FROM professional_unavailability_events WHERE contact_id=$1) ORDER BY purpose::text", [f.contactId])).rows;
    assert.deepEqual(rows.map((r) => r.purpose), ["customer_contact_update", "professional_reply"]);
    assert.ok(!JSON.stringify(first.result).includes(f.customerPhone));
  } finally { await f.cleanup(); }
});

test("decline preserves active search; explicit resume suspends it and replay never swaps again", async () => {
  const f = await fixture(true);
  try {
    const before = await query("SELECT to_jsonb(c) AS value FROM search_conversations c WHERE id=$1", [f.otherId]);
    await f.send(`não posso atender ${f.code}`);
    assert.deepEqual((await query("SELECT to_jsonb(c) AS value FROM search_conversations c WHERE id=$1", [f.otherId])).rows, before.rows);
    const notice = (await query("SELECT text_content FROM channel_outbound_messages WHERE purpose='customer_contact_update' AND recipient_phone_e164=$1", [f.customerPhone])).rows[0].text_content;
    assert.match(notice, /eletricista/); assert.match(notice, /encanador/); assert.match(notice, /retomar CC-/);
    await f.send("continuar aqui", f.customerPhone);
    const uncertain = await f.send("posso retomar?", f.customerPhone);
    assert.equal(uncertain.result.route === "opportunity" && uncertain.result.result.kind, "clarification");
    assert.equal((await f.conversations()).find((c) => c.id === f.otherId)?.status, "active");
    const id = randomUUID();
    await f.send(`retomar ${f.code}`, f.customerPhone, id);
    assert.equal((await f.conversations()).find((c) => c.id === f.conversationId)?.status, "active");
    assert.equal((await f.conversations()).find((c) => c.id === f.otherId)?.resume_slot, "location");
    await f.send("quero voltar para a busca de encanador", f.customerPhone);
    await f.send(`retomar ${f.code}`, f.customerPhone, id);
    assert.equal((await f.conversations()).find((c) => c.id === f.otherId)?.status, "active");
    assert.equal((await f.conversations()).filter((c) => c.status === "active").length, 1);
  } finally { await f.cleanup(); }
});

test("expired prior search does not replace current context or reuse options", async () => {
  const f = await fixture(true);
  try {
    await query("UPDATE search_conversations SET expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1", [f.conversationId]);
    await f.send(`recuso ${f.code}`);
    const result = await f.send(`retomar ${f.code}`, f.customerPhone);
    assert.equal(result.result.route === "opportunity" && result.result.result.kind, "expired");
    assert.match(result.reply_text, /nova busca/);
    assert.equal((await f.conversations()).find((c) => c.status === "active")?.id, f.otherId);
  } finally { await f.cleanup(); }
});

test("two simultaneous recuso deliveries produce one transition and one unavailability event", async () => {
  const f = await fixture();
  try {
    const results = await f.concurrentDecisions([`recuso ${f.code}`, `recuso ${f.code}`]);
    assert.equal(results[0].outbound.id, results[1].outbound.id);
    assert.equal(await f.countUnavailabilityEvents(), 1);
  } finally { await f.cleanup(); }
});

test("questions do not decide and foreign opportunity codes do not disclose ownership", async () => {
  const f = await fixture();
  try {
    const question = await f.send(`posso atender ${f.code}?`);
    assert.equal(question.result.route === "opportunity" && question.result.result.kind, "clarification");
    assert.equal(await f.countEvents(), 0);
    assert.equal(await f.countUnavailabilityEvents(), 0);
    const foreign = await f.send(`aceito ${f.code}`, f.customerPhone);
    assert.equal(foreign.result.route === "opportunity" && foreign.result.result.kind, "unavailable");
    const unknown = await f.send("aceito CC-23456789", f.customerPhone);
    assert.equal(unknown.reply_text, foreign.reply_text);
    for (const uncertain of ["talvez", "e se eu aceitar?", "não sei"]) {
      const clarification = await f.send(uncertain);
      assert.equal(clarification.result.route === "opportunity" && clarification.result.result.kind, "clarification");
    }
    assert.equal(await f.countEvents(), 0);
    assert.equal(await f.countUnavailabilityEvents(), 0);
    const accepted = await f.send(`aceito ${f.code}`);
    assert.equal(accepted.result.route === "opportunity" && accepted.result.result.kind, "acknowledged");
    assert.equal(await f.countEvents(), 0);
    assert.equal(await f.countUnavailabilityEvents(), 0);
  } finally { await f.cleanup(); }
});

test("cancellation concurrent with refusal keeps the single-active constraint and never selects a substitute", async () => {
  const f = await fixture(true);
  try {
    await Promise.all([f.send(`recuso ${f.code}`), f.send("cancelar", f.customerPhone)]);
    assert.ok((await f.conversations()).filter((c) => c.status === "active").length <= 1);
    assert.equal((await f.conversations()).find((c) => c.id === f.otherId)?.status, "cancelled");
    assert.equal((await query("SELECT count(*)::int AS count FROM contacts WHERE customer_id=$1", [f.customerId])).rows[0].count, 1);
    assert.equal(await f.countUnavailabilityEvents(), 1);
  } finally { await f.cleanup(); }
});

test("crash before inbound completion rolls back all intentions and is recoverable", async () => {
  const f = await fixture();
  const delivery = randomUUID();
  try {
    await query(`CREATE FUNCTION fail_opportunity_completion() RETURNS trigger AS $$ BEGIN
      IF NEW.status='processed' AND NEW.result->>'route'='opportunity' THEN RAISE EXCEPTION 'opportunity-test-crash'; END IF;
      RETURN NEW; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_opportunity_completion BEFORE UPDATE ON channel_inbound_messages FOR EACH ROW EXECUTE FUNCTION fail_opportunity_completion()`);
    const response = await f.app.inject({method:"POST",url:"/internal/channel/inbound/messages",headers:{"x-internal-key":key},
      payload:{provider:"test",provider_message_id:delivery,phone_e164:f.professionalPhone,raw_text:`recuso ${f.code}`,country_code:"BR",limit:3}});
    assert.equal(response.statusCode,500);
    assert.equal(await f.countUnavailabilityEvents(),0);
    assert.equal((await query("SELECT status FROM contacts WHERE id=$1",[f.contactId])).rows[0].status,"shared");
    assert.equal((await query("SELECT id FROM channel_outbound_messages WHERE recipient_phone_e164 IN ($1,$2)",[f.customerPhone,f.professionalPhone])).rows.length,0);
    await query("DROP TRIGGER fail_opportunity_completion ON channel_inbound_messages; DROP FUNCTION fail_opportunity_completion()");
    await query("UPDATE channel_inbound_messages SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE provider_message_id=$1 AND phone_e164=$2",[delivery,f.professionalPhone]);
    await f.send(`recuso ${f.code}`,f.professionalPhone,delivery);
    assert.equal(await f.countUnavailabilityEvents(),1);
  } finally {
    await query("DROP TRIGGER IF EXISTS fail_opportunity_completion ON channel_inbound_messages; DROP FUNCTION IF EXISTS fail_opportunity_completion()");
    await f.cleanup();
  }
});

test("new conversation versus resume retains one active context without losing either search", async () => {
  const f = await fixture(true);
  try {
    await f.send(`recuso ${f.code}`);
    await query("UPDATE search_conversations SET status='cancelled',pending_slot=NULL WHERE id=$1", [f.otherId]);
    const repo = new PostgresSearchConversationRepository();
    const [resume, creation] = await Promise.allSettled([
      f.send(`retomar ${f.code}`, f.customerPhone),
      repo.createPending({ customerId:f.customerId, pendingSlot:"location", originalRawText:"pintor", serviceText:"pintor", locationText:null, countryCode:"BR", limitValue:3, ttlMinutes:30 }),
    ]);
    assert.equal(resume.status, "fulfilled");
    if (creation.status === "rejected") assert.equal(creation.reason.code, "23505");
    const rows = await f.conversations();
    assert.equal(rows.filter((c) => c.status === "active").length, 1);
    assert.ok(rows.some((c) => c.id === f.conversationId));
    assert.ok(rows.some((c) => c.id === f.otherId));
  } finally { await f.cleanup(); }
});

test("reopened search revalidates previously shown inactive professionals", async () => {
  const f = await fixture();
  const category = randomUUID(), service = randomUUID();
  try {
    await query("INSERT INTO service_categories (id,name,slug) VALUES ($1::uuid,'Teste',$1::text)", [category]);
    await query("INSERT INTO services (id,category_id,name,slug) VALUES ($1::uuid,$2,'Eletricista',$1::text)", [service, category]);
    await query("UPDATE search_requests SET service_id=$2 WHERE id=$1", [f.searchId, service]);
    await query("INSERT INTO professional_services (professional_id,service_id) VALUES ($1,$2)", [f.professionalId, service]);
    await query("INSERT INTO matches (search_request_id,professional_id,rank_position,shown_at) VALUES ($1,$2,2,NOW())", [f.searchId, f.professionalId]);
    await f.send(`recuso ${f.code}`);
    await query("UPDATE professionals SET status='suspended' WHERE id=$1", [f.professionalId]);
    const repo = new PostgresSelectionMatchRepository();
    assert.equal(await repo.findShownByPosition(f.searchId, 2), null);
    assert.deepEqual(await repo.listShown(f.searchId), []);
    assert.deepEqual(await repo.listNextUnshown(f.searchId, 3), []);
  } finally {
    await query("DELETE FROM professional_services WHERE professional_id=$1", [f.professionalId]);
    await f.cleanup();
    await query("DELETE FROM services WHERE id=$1", [service]);
    await query("DELETE FROM service_categories WHERE id=$1", [category]);
  }
});

test("natural professional unavailability 'não consigo hoje' is stable across different deliveries and sent replay", async () => {
  const f = await fixture();
  try {
    const first = await f.send(`não consigo hoje ${f.code}`);
    const repo = new PostgresChannelOutboundMessageRepository(), token = randomUUID();
    assert.ok(await repo.claim(first.outbound.id, token, 60));
    assert.equal(await repo.markSent(first.outbound.id, { processing_token: token, provider_message_id: randomUUID() }), true);
    const second = await f.send(`não consigo hoje ${f.code}`);
    assert.equal(second.outbound.id, first.outbound.id);
    assert.equal(second.outbound.status, "sent");
    assert.equal(await f.countUnavailabilityEvents(), 1);
  } finally { await f.cleanup(); }
});

test("natural professional acknowledgement 'posso atender' is stable across sent replay", async () => {
  const f = await fixture();
  try {
    const first = await f.send(`posso atender ${f.code}`);
    assert.equal(first.result.result.kind, "acknowledged");
    assert.equal(await f.countUnavailabilityEvents(), 0);
  } finally { await f.cleanup(); }
});

test("multiple pending opportunities and ambiguous resumptions require clarification", async () => {
  const f = await fixture(true);
  try {
    const other = await f.addOpportunity();
    const ambiguity = await f.send("aceito");
    assert.equal(ambiguity.result.route === "opportunity" && ambiguity.result.result.kind, "clarification");
    assert.ok(ambiguity.reply_text.includes(f.code)); assert.ok(ambiguity.reply_text.includes(other.publicCode));
    assert.equal(await f.countEvents(), 0);
    assert.equal(await f.countUnavailabilityEvents(), 0);
    await f.send(`recuso ${f.code}`);
    await query("UPDATE search_conversations SET resume_slot='selection' WHERE id=$1", [other.conversation]);
    const resume = await f.send("retomar eletricista", f.customerPhone);
    assert.equal(resume.result.route === "opportunity" && resume.result.result.kind, "clarification");
    assert.equal((await f.conversations()).find((c) => c.status === "active")?.id, f.otherId);
  } finally { await f.cleanup(); }
});

test("a professional with a customer conversation is not forced into the opportunity context", async () => {
  const f = await fixture();
  const dualCustomer = randomUUID(), dualConversation = randomUUID();
  try {
    await query("INSERT INTO customers (id,phone_e164) VALUES ($1,$2)", [dualCustomer, f.professionalPhone]);
    await query(`INSERT INTO search_conversations (id,customer_id,status,pending_slot,original_raw_text,service_text,country_code,limit_value,expires_at)
      VALUES ($1,$2,'active','location','pintor','pintor','BR',3,NOW()+INTERVAL '1 hour')`, [dualConversation, dualCustomer]);
    const ambiguous = await f.send("sim, consigo");
    assert.equal(ambiguous.result.route === "opportunity" && ambiguous.result.result.kind, "clarification");
    assert.equal(await f.countEvents(), 0);
    assert.equal(await f.countUnavailabilityEvents(), 0);
    await f.send(`aceito ${f.code}`);
    assert.equal((await query("SELECT status FROM search_conversations WHERE id=$1", [dualConversation])).rows[0].status, "active");
  } finally {
    await query("DELETE FROM search_conversations WHERE id=$1", [dualConversation]);
    await query("DELETE FROM customers WHERE id=$1", [dualCustomer]);
    await f.cleanup();
  }
});

test("Outbox failure rolls back decision, event and reopening; retry after crash succeeds once", async () => {
  const f = await fixture();
  const delivery = randomUUID();
  try {
    await query(`CREATE FUNCTION fail_opportunity_reply() RETURNS trigger AS $$ BEGIN
      IF NEW.purpose='professional_reply' THEN RAISE EXCEPTION 'opportunity-test-outbox-failure'; END IF;
      RETURN NEW; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_opportunity_reply BEFORE INSERT ON channel_outbound_messages FOR EACH ROW EXECUTE FUNCTION fail_opportunity_reply()`);
    const response = await f.app.inject({method:"POST",url:"/internal/channel/inbound/messages",headers:{"x-internal-key":key},
      payload:{provider:"test",provider_message_id:delivery,phone_e164:f.professionalPhone,raw_text:`recuso ${f.code}`,country_code:"BR",limit:3}});
    assert.equal(response.statusCode,500);
    assert.equal(await f.countUnavailabilityEvents(),0);
    assert.equal((await query("SELECT status FROM contacts WHERE id=$1",[f.contactId])).rows[0].status,"shared");
    assert.equal((await f.conversations())[0].status,"completed");
    assert.equal((await query("SELECT id FROM channel_outbound_messages WHERE recipient_phone_e164 IN ($1,$2)",[f.customerPhone,f.professionalPhone])).rows.length,0);
    await query("DROP TRIGGER fail_opportunity_reply ON channel_outbound_messages; DROP FUNCTION fail_opportunity_reply()");
    await query("UPDATE channel_inbound_messages SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE provider_message_id=$1 AND phone_e164=$2",[delivery,f.professionalPhone]);
    await f.send(`recuso ${f.code}`,f.professionalPhone,delivery);
    assert.equal(await f.countUnavailabilityEvents(),1);
    assert.equal((await f.send(`recuso ${f.code}`,f.professionalPhone,delivery)).duplicate,true);
  } finally {
    await query("DROP TRIGGER IF EXISTS fail_opportunity_reply ON channel_outbound_messages; DROP FUNCTION IF EXISTS fail_opportunity_reply()");
    await f.cleanup();
  }
});

test("migration 015 refuses destructive rollback and events cannot be overwritten", async () => {
  const f = await fixture();
  try {
    await query("INSERT INTO opportunity_response_events (contact_id, professional_id, inbound_id, previous_state, next_state, origin, rule_version) VALUES ($1, $2, $3, 'requested', 'accepted', 'channel_inbox', 'v1')", [f.contactId, f.professionalId, f.choiceId]);
    await assert.rejects(query("UPDATE opportunity_response_events SET next_state='declined' WHERE contact_id=$1",[f.contactId]),/append-only/);
    const before = await f.conversations();
    const beforeEvents = await query<{ contact_id: string; next_state: string; rule_version: string }>(
      "SELECT contact_id, next_state, rule_version FROM opportunity_response_events WHERE contact_id=$1",[f.contactId]);
    const beforeMigrations = await query<{ name: string }>(
      "SELECT name FROM pgmigrations WHERE name IN ('015_add_opportunity_responses','016_add_outbound_retry_schedule') ORDER BY name");
    const beforeOutbox = await query<{ id: string; status: string; purpose: string; text_content: string; next_attempt_at: string | null }>(
      `SELECT id::text, status, purpose, text_content, next_attempt_at::text
       FROM channel_outbound_messages
       WHERE recipient_phone_e164 IN ($1,$2) ORDER BY id`,[f.customerPhone,f.professionalPhone]);
    // Exercise the protected 015 rollback with the supported CLI syntax. The
    // explicit single transaction must roll back 016 as well when 015 rejects.
    await assert.rejects(rollbackThrough("015_add_opportunity_responses"), (error: unknown) => {
      assert.ok(error instanceof Error && "stderr" in error);
      assert.match(String(error.stderr),/OPPORTUNITY_RESPONSE_ROLLBACK_BLOCKED/);
      assert.match(String(error.stderr),/P0015/); return true;
    });
    const retryColumn = await query<{ column_name: string }>(`SELECT column_name
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='channel_outbound_messages'
        AND column_name='next_attempt_at'`);
    assert.equal(retryColumn.rows.length,1,"migration 016 must remain applied after the protected 015 rollback");
    const retryIndex = await query<{ index_name: string | null }>(
      "SELECT to_regclass('channel_outbound_messages_pending_next_attempt_idx') AS index_name");
    assert.equal(retryIndex.rows[0]?.index_name,"channel_outbound_messages_pending_next_attempt_idx");
    const migration016 = await query<{ name: string }>(
      "SELECT name FROM pgmigrations WHERE name='016_add_outbound_retry_schedule'");
    assert.deepEqual(migration016.rows,[{ name: "016_add_outbound_retry_schedule" }]);
    assert.deepEqual((await query<{ contact_id: string; next_state: string; rule_version: string }>(
      "SELECT contact_id, next_state, rule_version FROM opportunity_response_events WHERE contact_id=$1",[f.contactId])).rows,beforeEvents.rows);
    assert.deepEqual((await query<{ name: string }>(
      "SELECT name FROM pgmigrations WHERE name IN ('015_add_opportunity_responses','016_add_outbound_retry_schedule') ORDER BY name")).rows,beforeMigrations.rows);
    assert.deepEqual((await query<{ id: string; status: string; purpose: string; text_content: string; next_attempt_at: string | null }>(
      `SELECT id::text, status, purpose, text_content, next_attempt_at::text
       FROM channel_outbound_messages
       WHERE recipient_phone_e164 IN ($1,$2) ORDER BY id`,[f.customerPhone,f.professionalPhone])).rows,beforeOutbox.rows);
    assert.equal(await f.countEvents(),1);
    assert.deepEqual(await f.conversations(),before);
  } finally { await f.cleanup(); }
});

for (const page of [false, true]) {
  test(`decline permits ${page ? "show-more and selection after delivery" : "an eligible already shown alternative"} through Inbox`, async () => {
    const f = await fixture();
    const category = randomUUID(), service = randomUUID(), alternative = randomUUID(), matchId = randomUUID(), noticeId = randomUUID();
    const alternativePhone = phone();
    try {
      await query("INSERT INTO service_categories (id,name,slug) VALUES ($1::uuid,'Teste',$1::text)",[category]);
      await query("INSERT INTO services (id,category_id,name,slug) VALUES ($1::uuid,$2,'Eletricista',$1::text)",[service,category]);
      await query("UPDATE search_requests SET service_id=$2, location=ST_SetSRID(ST_MakePoint(-55.5,-11.86),4326)::geography,city='Sinop',state='MT' WHERE id=$1",[f.searchId,service]);
      await query("INSERT INTO professionals (id,display_name,slug,phone_e164,status) VALUES ($1::uuid,'Bia',$1::text,$2,'active')",[alternative,alternativePhone]);
      await query("INSERT INTO professional_services (professional_id,service_id) VALUES ($1,$2)",[alternative,service]);
      await query(`INSERT INTO professional_service_areas (professional_id,city,state,country_code,center,radius_meters)
        VALUES ($1,'Sinop','MT','BR',ST_SetSRID(ST_MakePoint(-55.5,-11.86),4326)::geography,40000)`,[alternative]);
      await query("INSERT INTO matches (id,search_request_id,professional_id,rank_position,shown_at) VALUES ($1,$2,$3,$4,$5)",
        [matchId,f.searchId,alternative,page ? 4 : 2,page ? null : new Date()]);
      if (!page) {
        await query("UPDATE channel_inbound_messages SET customer_id=$2,conversation_id=$3,search_request_id=$4 WHERE id=$1",[f.choiceId,f.customerId,f.conversationId,f.searchId]);
        await query(`INSERT INTO channel_outbound_messages (id,channel_inbound_message_id,provider,recipient_phone_e164,text_content,status,sent_at,provider_message_id,bilateral_notice_version)
          VALUES ($1,$2,'test',$3,$4,'sent',NOW(),'fixture-sent',$5)`,[noticeId,f.choiceId,f.customerPhone,BILATERAL_NOTICE,BILATERAL_NOTICE_VERSION]);
        await query("INSERT INTO channel_outbound_message_matches (channel_outbound_message_id,match_id) VALUES ($1,$2)",[noticeId,matchId]);
      }
      await f.send(`recuso ${f.code}`);
      if (page) {
        const next = await f.send("mostrar mais",f.customerPhone);
        assert.match(next.reply_text,/4\./);
        assert.equal((await query("SELECT shown_at FROM matches WHERE id=$1",[matchId])).rows[0].shown_at,null);
        const invisible = await f.send("Bia",f.customerPhone);
        assert.equal(invisible.result.route === "selection" && invisible.result.result.kind === "selected",false);
        const repo = new PostgresChannelOutboundMessageRepository(), token = randomUUID();
        assert.ok(await repo.claim(next.outbound.id,token,60));
        assert.equal(await repo.markSent(next.outbound.id,{processing_token:token,provider_message_id:randomUUID()}),true);
      }
      const selected = await f.send("Bia",f.customerPhone);
      assert.equal(selected.result.route === "selection" && selected.result.result.kind,"selected");
      const contacts = (await query("SELECT status FROM contacts WHERE search_request_id=$1 ORDER BY status::text",[f.searchId])).rows;
      assert.deepEqual(contacts.map((c)=>c.status),["shared","shared"]);
      assert.equal(await f.countUnavailabilityEvents(),1);
      assert.equal((await query("SELECT id FROM channel_outbound_messages WHERE purpose='professional_contact_notification' AND recipient_phone_e164=$1",[alternativePhone])).rows.length,1);
    } finally {
      await query("DELETE FROM channel_outbound_messages WHERE recipient_phone_e164=$1",[alternativePhone]);
      await f.cleanup();
      await query("DELETE FROM professional_service_areas WHERE professional_id=$1",[alternative]);
      await query("DELETE FROM professional_services WHERE professional_id=$1",[alternative]);
      await query("DELETE FROM professionals WHERE id=$1",[alternative]);
      await query("DELETE FROM services WHERE id=$1",[service]);
      await query("DELETE FROM service_categories WHERE id=$1",[category]);
    }
  });
}

test("migration 027 refuses destructive rollback when unavailability events exist and events are immutable (P0027)", async () => {
  const f = await fixture();
  try {
    await f.send(`recuso ${f.code}`);
    assert.equal(await f.countUnavailabilityEvents(), 1);
    // Immutability trigger test
    await assert.rejects(
      query("UPDATE professional_unavailability_events SET origin='manual' WHERE contact_id=$1", [f.contactId]),
      (error: unknown) => {
        assert.ok(error instanceof Error && "code" in error && (error as { code: string }).code === "P0027");
        assert.match((error as Error).message, /PROFESSIONAL_UNAVAILABILITY_EVENT_IMMUTABLE/);
        return true;
      }
    );
    await assert.rejects(
      query("DELETE FROM professional_unavailability_events WHERE contact_id=$1", [f.contactId]),
      (error: unknown) => {
        assert.ok(error instanceof Error && "code" in error && (error as { code: string }).code === "P0027");
        assert.match((error as Error).message, /PROFESSIONAL_UNAVAILABILITY_EVENT_IMMUTABLE/);
        return true;
      }
    );
    // Protected rollback test
    await assert.rejects(rollbackThrough("027_add_connection_lifecycle_v2"), (error: unknown) => {
      assert.ok(error instanceof Error && "stderr" in error);
      assert.match(String(error.stderr), /CONNECTION_LIFECYCLE_V2_ROLLBACK_BLOCKED/);
      assert.match(String(error.stderr), /P0027/);
      return true;
    });
    const applied027 = await query<{ name: string }>(
      "SELECT name FROM pgmigrations WHERE name='027_add_connection_lifecycle_v2'"
    );
    assert.deepEqual(applied027.rows, [{ name: "027_add_connection_lifecycle_v2" }]);
  } finally { await f.cleanup(); }
});

test("customer selects João; João unavailable; customer returns and selects Carlos in same search request", async () => {
  const f = await fixture();
  const category = randomUUID(), service = randomUUID(), carlosId = randomUUID(), matchId = randomUUID();
  const carlosPhone = phone();
  let presInboundId: string | null = null, presOutboundId: string | null = null;
  try {
    await query("INSERT INTO service_categories (id,name,slug) VALUES ($1::uuid,'Teste',$1::text)", [category]);
    await query("INSERT INTO services (id,category_id,name,slug) VALUES ($1::uuid,$2,'Eletricista',$1::text)", [service, category]);
    await query("UPDATE search_requests SET service_id=$2, location=ST_SetSRID(ST_MakePoint(-55.5,-11.86),4326)::geography,city='Sinop',state='MT' WHERE id=$1", [f.searchId, service]);
    await query("INSERT INTO professionals (id,display_name,slug,phone_e164,status) VALUES ($1::uuid,'Carlos',$1::text,$2,'active')", [carlosId, carlosPhone]);
    await query("INSERT INTO professional_services (professional_id,service_id) VALUES ($1,$2)", [carlosId, service]);
    await query(`INSERT INTO professional_service_areas (professional_id,city,state,country_code,center,radius_meters)
      VALUES ($1,'Sinop','MT','BR',ST_SetSRID(ST_MakePoint(-55.5,-11.86),4326)::geography,40000)`, [carlosId]);
    await query("INSERT INTO matches (id,search_request_id,professional_id,rank_position,shown_at) VALUES ($1,$2,$3,2,NOW())", [matchId, f.searchId, carlosId]);
    const presInbound = await query<{ id: string }>(`INSERT INTO channel_inbound_messages (provider, provider_message_id, phone_e164, raw_text, country_code, limit_value, status, processed_at, result)
      VALUES ('test', $1, $2, 'carlos', 'BR', 3, 'processed', NOW(), '{}'::jsonb) RETURNING id`, [randomUUID(), f.customerPhone]);
    presInboundId = presInbound.rows[0].id;
    const presOutbound = await query<{ id: string }>(`INSERT INTO channel_outbound_messages (channel_inbound_message_id, provider, recipient_phone_e164, text_content, status, sent_at, bilateral_notice_version, provider_message_id)
      VALUES ($1, 'test', $2, $3, 'sent', NOW(), 'bilateral-v1', $4) RETURNING id`,
      [presInboundId, f.customerPhone, `1. Carlos\n${BILATERAL_NOTICE}`, randomUUID()]);
    presOutboundId = presOutbound.rows[0].id;
    await query("INSERT INTO channel_outbound_message_matches (channel_outbound_message_id, match_id) VALUES ($1, $2)", [presOutboundId, matchId]);

    // João declares unavailability via "não consigo"
    const unavail = await f.send(`não consigo ${f.code}`);
    assert.equal(unavail.result.result.kind, "unavailability_declared");
    assert.equal(await f.countUnavailabilityEvents(), 1);

    // Customer selects Carlos
    const selected = await f.send("Carlos", f.customerPhone);
    assert.equal(selected.result.route, "selection");
    assert.equal(selected.result.result.kind, "selected");

    // Both contacts exist for the same search request and both have status 'shared'!
    const contacts = (await query<{ professional_id: string; status: string }>(
      "SELECT professional_id, status FROM contacts WHERE search_request_id=$1 ORDER BY created_at",
      [f.searchId]
    )).rows;
    assert.equal(contacts.length, 2);
    assert.deepEqual(contacts.map(c => c.status), ["shared", "shared"]);
    assert.equal(contacts[0].professional_id, f.professionalId);
    assert.equal(contacts[1].professional_id, carlosId);

    // João's unavailability event remains intact and Carlos has no unavailability event
    assert.equal(await f.countUnavailabilityEvents(), 1);
  } finally {
    await query("DELETE FROM channel_outbound_message_matches WHERE match_id=$1", [matchId]);
    if (presOutboundId) await query("DELETE FROM channel_outbound_messages WHERE id=$1", [presOutboundId]);
    if (presInboundId) await query("DELETE FROM channel_inbound_messages WHERE id=$1", [presInboundId]);
    await query("DELETE FROM channel_outbound_messages WHERE recipient_phone_e164=$1", [carlosPhone]);
    await query("DELETE FROM contacts WHERE professional_id=$1", [carlosId]);
    await query("DELETE FROM matches WHERE id=$1", [matchId]);
    await query("DELETE FROM professional_service_areas WHERE professional_id=$1", [carlosId]);
    await query("DELETE FROM professional_services WHERE professional_id=$1", [carlosId]);
    await query("DELETE FROM professionals WHERE id=$1", [carlosId]);
    await query("DELETE FROM services WHERE id=$1", [service]);
    await query("DELETE FROM service_categories WHERE id=$1", [category]);
    await f.cleanup();
  }
});

test("unavailability vs completion declaration concurrency is deterministic with no deadlocks", async () => {
  const f = await fixture();
  try {
    await Promise.all([
      f.send(`recuso ${f.code}`, f.professionalPhone),
      f.send(`concluído ${f.code}`, f.customerPhone),
    ]);
    assert.equal(await f.countUnavailabilityEvents(), 1);
    const contact = (await query<{ status: string }>("SELECT status FROM contacts WHERE id=$1", [f.contactId])).rows[0];
    assert.ok(["shared", "completed"].includes(contact.status));
  } finally { await f.cleanup(); }
});
