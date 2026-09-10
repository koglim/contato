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

after(closeDatabaseConnection);
const headers = { "x-internal-key": "b2-integration" };
const basic = (overrides: Partial<ContextualProposal> = {}): ContextualProposal => ({ intent: "search", services: [], location: null, uncertain: false, ...overrides });

async function fixture() {
  const serviceId = randomUUID(), categoryId = randomUUID();
  const name = `Encanador${serviceId.replaceAll("-", "")}`;
  const phone = `+5566${BigInt(`0x${randomUUID().replaceAll("-", "").slice(0, 8)}`).toString().padStart(10, "0")}`;
  const professionalIds = [randomUUID(), randomUUID()];
  await query("INSERT INTO service_categories(id,name,slug) VALUES ($1::uuid,'B2 fixture',$1::text)", [categoryId]);
  await query("INSERT INTO services(id,category_id,name,slug) VALUES ($1,$2,$3,$3)", [serviceId, categoryId, name]);
  for (const [index, id] of professionalIds.entries()) {
    await query("INSERT INTO professionals(id,display_name,slug,phone_e164,status) VALUES ($1::uuid,$2,$1::text,$3,'active')", [id, `Profissional ${index + 1}`, `+5566${Math.floor(Math.random() * 1e9).toString().padStart(9, "0")}`]);
    await query("INSERT INTO professional_services(professional_id,service_id) VALUES ($1,$2)", [id, serviceId]);
    await query(`INSERT INTO professional_service_areas(professional_id,city,state,country_code,center,radius_meters)
      VALUES ($1,'Sinop','MT','BR',ST_SetSRID(ST_MakePoint(-55.5,-11.86),4326)::geography,10000)`, [id]);
  }
  let calls = 0, geoCalls = 0;
  let next: (text: string) => Promise<unknown> = async () => basic();
  const provider: ContextualProvider = { model: "unit-fake-no-model-call", async interpret(input) { calls++; return next(input.message); } };
  const contextual = new ContextualConversationService(provider, { async resolve(input) {
    geoCalls++;
    return { status: "resolved", query: input.query, country_code: "BR", provider: "fake", candidates: [],
      match: { label: input.query, latitude: -11.86, longitude: -55.5, city: input.query, state: "MT", country_code: "BR", neighborhood: null, confidence: 1, layer: "locality" } };
  } });
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
      await client.query("DELETE FROM channel_inbound_messages WHERE phone_e164=$1", [phone]);
      await client.query("DELETE FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [phone]);
      await client.query("DELETE FROM search_conversations WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [phone]);
      await client.query("DELETE FROM matches WHERE search_request_id IN (SELECT id FROM search_requests WHERE service_id=$1)", [serviceId]);
      await client.query("DELETE FROM search_requests WHERE service_id=$1", [serviceId]);
      await client.query("DELETE FROM customers WHERE phone_e164=$1", [phone]);
      await client.query("DELETE FROM professional_service_areas WHERE professional_id=ANY($1::uuid[])", [professionalIds]);
      await client.query("DELETE FROM professional_services WHERE service_id=$1", [serviceId]);
      await client.query("DELETE FROM professionals WHERE id=ANY($1::uuid[])", [professionalIds]);
      await client.query("DELETE FROM services WHERE id=$1", [serviceId]);
      await client.query("DELETE FROM service_categories WHERE id=$1", [categoryId]);
    });
  };
  return { name, phone, serviceId, app, receive, sent, state, cleanup, calls: () => calls, geoCalls: () => geoCalls, set: (fn: typeof next) => { next = fn; } };
}

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
    const replay = await f.receive("quero o segundo", selectionId);
    assert.equal(replay.json().outbound.id, chosen.json().outbound.id); assert.equal(replay.json().duplicate, true);
    assert.equal((await query("SELECT COUNT(*)::int count FROM contacts WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [f.phone])).rows[0].count <= 1, true);
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
