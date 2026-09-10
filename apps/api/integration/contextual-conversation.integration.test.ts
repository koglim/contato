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

after(closeDatabaseConnection);
const headers = { "x-internal-key": "b2-integration" };
const basic = (overrides: Partial<ContextualProposal> = {}): ContextualProposal => ({ intent: "search", services: [], location: null, uncertain: false, ...overrides });

test("B2 natural clarification is persisted before effects; retry does not regenerate", async () => {
  const f = await fixture();
  try {
    f.setCompose(async input => { assert.equal(input.target, "location"); return { question: "Em qual cidade você precisa desse atendimento?" }; });
    await query(`CREATE FUNCTION b2_fail_outbound() RETURNS trigger AS $$ BEGIN
      IF NEW.recipient_phone_e164 = '${f.phone}' THEN RAISE EXCEPTION 'injected B2 outbox failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await query("CREATE TRIGGER b2_fail_outbound BEFORE INSERT ON channel_outbound_messages FOR EACH ROW EXECUTE FUNCTION b2_fail_outbound()");
    const id = randomUUID(), text = `preciso de ${f.name}`;
    assert.equal((await f.receive(text, id)).statusCode, 500);
    assert.equal((await query("SELECT id FROM search_conversations WHERE customer_id IN (SELECT id FROM customers WHERE phone_e164=$1)", [f.phone])).rows.length, 0);
    const calls = f.calls(), compositions = f.compositions();
    await query("DROP TRIGGER b2_fail_outbound ON channel_outbound_messages"); await query("DROP FUNCTION b2_fail_outbound()");
    const retry = await f.receive(text, id); assert.equal(retry.statusCode, 200, retry.body);
    assert.equal(retry.json().reply_text, "Em qual cidade você precisa desse atendimento?");
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
    const before = await f.state(), calls = f.calls();
    await query(`UPDATE contextual_budgets SET calls=20 WHERE scope IN (SELECT id::text FROM customers WHERE phone_e164=$1)`, [f.phone]);
    const exhausted = await f.receive("Na verdade é em Vera"); assert.equal(exhausted.statusCode, 200, exhausted.body);
    assert.equal(exhausted.json().result.status, "fallback"); assert.equal(f.calls(), calls);
    assert.deepEqual((await f.state()).memory, before.memory);
    await query(`DELETE FROM contextual_budgets WHERE scope IN (SELECT id::text FROM customers WHERE phone_e164=$1)`, [f.phone]);
    f.set(() => new Promise(() => {}));
    const timeout = await f.receive("Ainda preciso desse atendimento"); assert.equal(timeout.statusCode, 200, timeout.body);
    assert.equal(timeout.json().result.status, "fallback"); assert.deepEqual((await f.state()).memory, before.memory);
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
    const renewed = await repository.acquire(record, "fake"); assert.equal(renewed.proposal, null);
    assert.equal(renewed.memory.location?.value, "Sorriso"); await repository.release(renewed);
  } finally { await f.cleanup(); }
});

test("B2 arrival FIFO includes an earlier inbound before its contextual handler starts", async () => {
  const f = await fixture();
  try {
    f.set(async () => basic({ intent: "faq_cost" }));
    const inbox = new PostgresChannelInboundMessageRepository(), repository = new PostgresContextualRepository();
    const payload = (id: string) => ({ provider: "b2-test", provider_message_id: id, phone_e164: f.phone, raw_text: "Quanto custa usar?", country_code: "BR", limit: 3 });
    const firstId = randomUUID(), secondId = randomUUID();
    await inbox.createOrFind(payload(firstId), { contextual: true });
    const second = await inbox.createOrFind(payload(secondId), { contextual: true });
    const claimed = await inbox.claim(second.record.id, randomUUID(), 60); assert.ok(claimed);
    await assert.rejects(repository.acquire(claimed, "fake"));
    assert.equal((await query("SELECT id FROM channel_outbound_messages WHERE recipient_phone_e164=$1", [f.phone])).rows.length, 0);
    const first = await f.receive("Quanto custa usar?", firstId); assert.equal(first.statusCode, 200, first.body);
    await inbox.markFailed(claimed.id, claimed.processingToken!, "contextual_processing");
    const retry = await f.receive("Quanto custa usar?", secondId); assert.equal(retry.statusCode, 200, retry.body);
    assert.notEqual(first.json().outbound.id, retry.json().outbound.id);
  } finally { await f.cleanup(); }
});

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
  let compose: ContextualProvider["composeQuestion"];
  let compositions = 0;
  const provider: ContextualProvider = { model: "unit-fake-no-model-call", async interpret(input) { calls++; return next(input.message); },
    async composeQuestion(input) { compositions++; if (!compose) throw new Error("no fake composer configured"); return compose(input); } };
  let resolveLocation: LocationResolutionService["resolve"] = async input => {
    return { status: "resolved", query: input.query, country_code: "BR", provider: "fake", candidates: [],
      match: { label: input.query, latitude: -11.86, longitude: -55.5, city: input.query, state: "MT", country_code: "BR", neighborhood: null, confidence: 1, layer: "locality" } };
  };
  const contextual = new ContextualConversationService(provider, { async resolve(input) { geoCalls++; return resolveLocation(input); } });
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
  return { name, phone, serviceId, app, receive, sent, state, cleanup, calls: () => calls, geoCalls: () => geoCalls, compositions: () => compositions,
    set: (fn: typeof next) => { next = fn; }, setCompose: (fn: NonNullable<typeof compose>) => { compose = fn; }, setGeo: (fn: typeof resolveLocation) => { resolveLocation = fn; } };
}

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
    await query("UPDATE channel_inbound_messages SET status='failed', result=NULL WHERE id=$1", [chosen.json().message_id]);
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
